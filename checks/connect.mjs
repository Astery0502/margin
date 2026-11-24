import { copyTestExtension } from './fixtures/native-extension.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = await mkdtemp(join(tmpdir(), 'margin-connect-check-'));
const extension = join(root,'extension');
const issuer = 'https://auth.openai.com';
const clientId = 'oaiapp_fixture';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'fixture' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
let invalidNonce = true, streamClosed = false;
let pending, calls = 0, refreshes = 0, revoked = false, release, failure;
let context, consentServer;
const server = createServer(async (req, res) => {
  const json = value => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  try {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const body = Buffer.concat(chunks).toString();
    switch (req.url) {
      case '/': return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Article</title><p>A passage for a subscription discussion.</p>');
      case '/.well-known/openid-configuration': return json({ issuer, jwks_uri: issuer + '/keys', revocation_endpoint: issuer + '/revoke' });
      case '/keys': return json({ keys: [jwk] });
      case '/api/accounts/oauth/token': {
        const form = new URLSearchParams(body);
        assert.equal(form.get('client_id'), clientId);
        assert.equal(form.get('resource'), 'https://api.openai.com/v1');
        if (form.get('grant_type') === 'refresh_token') {
          assert.equal(form.get('refresh_token'), 'fixture-refresh');
          refreshes++;
          return json({ access_token: 'renewed', refresh_token: 'rotated', expires_in: 3600, token_type: 'Bearer' });
        }
        assert.equal(form.get('code'), 'fixture-code');
        assert.equal(form.get('redirect_uri'), pending.get('redirect_uri'));
        assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), pending.get('code_challenge'));
        const header = encode({ alg: 'RS256', kid: jwk.kid });
        const claims = encode({ iss: issuer, aud: clientId, sub: 'reader', email: 'reader@example.test', exp: Math.floor(Date.now()/1000)+300, nonce: invalidNonce ? 'wrong-attempt' : pending.get('nonce') });
        const data = header + '.' + claims;
        return json({ id_token: data + '.' + sign('sha256', Buffer.from(data), privateKey).toString('base64url'),
          scope: 'openid chatgpt.tokens.use.direct', token_type: 'Bearer', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 30 });
      }
      case '/v1/models':
        assert.equal(req.headers.authorization, 'Bearer renewed');
        return json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'Subscription model', visibility: 'list' }] });
      case '/v1/responses': {
        assert.equal(req.headers.authorization, 'Bearer renewed');
        const payload = JSON.parse(body);
        assert.equal(payload.stream, true); assert.equal(payload.store, false);
        assert.match(JSON.stringify(payload.input), /Keep my question/);
        assert.ok(!('background' in payload) && !('max_output_tokens' in payload));
        assert.ok(!payload.tools && !payload.input.some(item => item.role === 'system'));
        assert.ok(payload.input.some(item => item.type === 'additional_tools' && item.tools.some(tool => tool.name === 'ask_reader')));
        if (JSON.stringify(payload.input.at(-1)).includes('Check rate limit')) return res.writeHead(429).end();
        calls++;
        const finishStream = new Promise(resolve => {
          release = resolve;
          res.once('close', () => { if (!res.writableEnded) streamClosed = true; resolve(); });
        });
        res.writeHead(200, calls === 1 ? {} : { 'Content-Type': 'text/event-stream' });
        const event = (type, values) => res.write('data: ' + JSON.stringify({ type, ...values }) + '\n\n');
        const item = { type: 'message', id: 'msg_read', role: 'assistant', content: [] };
        event('response.created', { response: { id: 'r_read' } });
        event('response.output_item.added', { item, output_index: 0 });
        // Let the leading message-update flush before checking the partial answer.
        await new Promise(resolve => setTimeout(resolve, 160));
        event('response.output_text.delta', { output_index: 0, delta: 'First passage' });
        await finishStream;
        if (res.destroyed) return;
        item.content.push({ type: 'output_text', text: 'First passage discussed.' });
        event('response.output_item.done', { output_index: 0, item });
        event('response.completed', { response: { id: 'r_read', status: 'completed', output: [item] } });
        return res.end();
      }
      case '/revoke':
        assert.ok(['rotated', 'fixture-refresh'].includes(new URLSearchParams(body).get('token')));
        revoked = true;
        return res.writeHead(200).end();
      default: return res.writeHead(404).end();
    }
  } catch (error) { failure = error; res.writeHead(500).end(); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixture = 'http://127.0.0.1:' + server.address().port;
  const cert = join(root, 'cert.pem'), key = join(root, 'key.pem');
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=auth.openai.com','-keyout',key,'-out',cert], {stdio:'ignore'});
  const pub = execFileSync('openssl',['x509','-in',cert,'-pubkey','-noout']);
  const spki = createHash('sha256').update(execFileSync('openssl',['pkey','-pubin','-outform','DER'],{input:pub})).digest('base64');
  consentServer = createTlsServer({ cert: await readFile(cert), key: await readFile(key) }, (req,res) => {
    if (!req.url.startsWith('/api/accounts/authorize?')) return res.writeHead(404).end();
    pending = new URL(req.url, issuer).searchParams;
    res.writeHead(200, {'Content-Type':'text/html'}).end('<title>Fixture consent</title><p>Controlled consent</p>');
  });
  await new Promise(resolve => consentServer.listen(0, '127.0.0.1', resolve));
  const profile = join(root, 'browser');
  const launch = () => chromium.launchPersistentContext(profile, { executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--no-proxy-server','--host-resolver-rules=MAP auth.openai.com 127.0.0.1:' + consentServer.address().port, '--ignore-certificate-errors-spki-list=' + spki, '--load-extension=' + extension, '--disable-extensions-except=' + extension] });
  await copyTestExtension(extension);
  context = await launch();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // Node URL treats the extension scheme as opaque.
  const extensionOrigin = 'chrome-extension://' + new URL(worker.url()).host + '/';
  const cachedGo = resolve('.cache/toolchains/go/bin/go');
  const go = process.env.GO || await access(cachedGo).then(() => cachedGo, () => 'go');
  const binary = join(root, 'check-host');
  execFileSync(go, ['test', '-c', '-ldflags', '-X margin.local/connect.origins=' + extensionOrigin, '-o', binary], { cwd: 'companion' });
  const page = await context.newPage();
  await page.goto(fixture);
  await page.locator('body > p').evaluate(p => {
    const range = document.createRange(); range.selectNodeContents(p); getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Quick', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Discussion draft' });
  await draft.fill('Keep my question.');
  const setupOpening = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Connect ChatGPT to send' }).click();
  const setup = await setupOpening;
  await expect(setup.locator('#status')).toContainText('Margin Connect');
  if (await access('dist/providers/Margin-Connect-macOS.zip').then(() => true, () => false)) {
    await expect(setup.locator('#download')).toBeVisible();
    const download = setup.waitForEvent('download');
    await setup.locator('#download').click();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'Margin-Connect-macOS.zip');
    assert.equal(await file.failure(), null);
  }
  const dir = join(root, 'Margin', 'Connect');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'fixture-url'), fixture);
  const consentOpening = () => context.waitForEvent('page', { predicate: tab =>
    tab.waitForURL(url => url.origin === issuer, { timeout: 3000 }).then(() => true, () => false) });
  const approval = consentOpening();
  execFileSync(binary, ['--install-fixture', root]);
  const consent = await approval;
  await expect(consent).toHaveTitle('Fixture consent');
  assert.equal(pending.get('client_id'), 'dynamic_agent_client');
  assert.equal(pending.get('agent_name_hint'), 'Margin');
  const callback = () => {
    const target = new URL(pending.get('redirect_uri'));
    target.search = new URLSearchParams({ state: pending.get('state'), client_id: clientId, code: 'fixture-code' });
    return target;
  };
  const wrongState = callback();
  wrongState.searchParams.set('state', 'unrelated-attempt');
  assert.equal((await fetch(wrongState)).status, 400);
  await consent.goto(callback().href).catch(() => {});
  await expect(setup.locator('#status')).toContainText('could not be verified');
  assert.equal(calls, 0);
  invalidNonce = false;
  const retry = consentOpening();
  await setup.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  const returning = await retry;
  await expect(returning).toHaveTitle('Fixture consent');
  assert.equal(pending.get('client_id'), clientId);
  await returning.goto(callback().href).catch(() => {});
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Keep my question.');
  assert.equal(calls, 0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const panel = await context.newPage();
  await panel.goto(extensionOrigin + 'sidepanel.html');
  const detail = async () => panel.evaluate(async () => {
    const [entry] = (await PiBrowser.request('browse')).sessions;
    return entry && PiBrowser.request('detail', { sessionId: entry.id });
  });
  await expect.poll(async () => { const entry = await detail(); if (entry?.error) throw new Error(entry.error); return JSON.stringify({ calls, status: entry?.status, messages: entry?.messages, error: entry?.error }); }).toContain('First passage');
  await expect(page.getByText('First passage', { exact: true })).toBeVisible();
  release();
  await expect.poll(async () => JSON.stringify((await detail())?.messages)).toContain('First passage discussed.');
  assert.equal(refreshes, 1); assert.equal(calls, 1);
  // Exercise disconnection while another authorized stream is still open.
  const control = await context.newPage();
  await control.goto(extensionOrigin + 'connect.html');
  const sessionId = (await detail()).id;
  await panel.evaluate(sessionId => PiBrowser.request('send', { sessionId, text: 'Check rate limit' }), sessionId);
  await expect.poll(async () => (await detail()).error).toMatch(/429.*usage limits/);
  await panel.evaluate(sessionId => PiBrowser.request('send', { sessionId, text: 'Keep my question in this follow-up.' }), sessionId);
  await expect.poll(() => calls).toBe(2);
  await control.getByRole('button', { name: 'Disconnect account' }).click();
  await expect.poll(() => streamClosed).toBe(true);
  await expect.poll(async () => (await detail()).status).toBe('cancelled');
  await expect(control.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  assert.ok(revoked);
  // Reauthorize this saved identity, then check the resulting session across a restart.
  const relogin = consentOpening();
  await control.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  const approved = await relogin;
  await expect(approved).toHaveTitle('Fixture consent');
  assert.equal(pending.get('client_id'), clientId);
  await approved.goto(callback().href).catch(() => {});
  await expect(control.locator('#status')).toContainText('reader@example.test');
  await context.close();
  context = await launch();
  const settings = await context.newPage();
  await settings.goto(extensionOrigin + 'connect.html');
  await expect(settings.locator('#status')).toContainText('reader@example.test');
  await settings.getByRole('button', { name: 'Disconnect account' }).click();
  await expect(settings.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  assert.ok(revoked);
  const saved = JSON.parse(await readFile(join(dir, 'session.json')));
  assert.equal(saved.Session, null);
  assert.equal(saved.Registration.id, clientId);
  console.log('Native setup, OAuth verification, draft return, refresh, incremental SDK stream, restart and revocation passed.');
} finally {
  release?.();
  await context?.close();
  consentServer?.closeAllConnections();
  consentServer?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
  if (failure) throw failure;
}
