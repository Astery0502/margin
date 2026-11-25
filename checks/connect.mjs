import { copyTestExtension, launchTestExtension } from './fixtures/native-extension.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';

const root = await mkdtemp(join(tmpdir(), 'margin-connect-check-'));
const extension = join(root,'extension');
const issuer = 'https://auth.openai.com';
const clientId = 'oaiapp_fixture';
const availableModels = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra'];
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'fixture' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
let denyToken = true, invalidNonce = true, streamClosed = false;
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
        if (denyToken) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          return res.flushHeaders(); // The helper can report the refusal before the body arrives.
        }
        const header = encode({ alg: 'RS256', kid: jwk.kid });
        const claims = encode({ iss: issuer, aud: clientId, sub: 'reader', email: 'reader@example.test', exp: Math.floor(Date.now()/1000)+300, nonce: invalidNonce ? 'wrong-attempt' : pending.get('nonce') });
        const data = header + '.' + claims;
        return json({ id_token: data + '.' + sign('sha256', Buffer.from(data), privateKey).toString('base64url'),
          scope: 'openid chatgpt.tokens.use.direct', token_type: 'Bearer', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 30 });
      }
      case '/models':
        if (req.headers.authorization !== 'Bearer fixture-deepseek') return res.writeHead(401).end();
        return json({ data: [{ id: 'deepseek-flash' }, { id: 'unknown-model' }] });
      case '/chat/completions': {
        assert.equal(req.headers.authorization, 'Bearer fixture-deepseek');
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'deepseek-flash');
        assert.equal(payload.stream, true);
        assert.match(JSON.stringify(payload.messages), /Read with DeepSeek/);
        assert.ok(payload.tools.some(tool => tool.function.name === 'ask_reader'));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason) => 'data: ' + JSON.stringify({ id: 'ds-read', model: payload.model,
          choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
        return res.end(chunk({ role: 'assistant', content: 'DeepSeek discussed the passage.' }, null)
          + chunk({}, 'stop') + 'data: [DONE]\n\n');
      }
      case '/v1/models':
        assert.equal(req.headers.authorization, 'Bearer renewed');
        return json({ models: availableModels.map(slug => ({ slug, visibility: 'list' })) });
      case '/v1/responses': {
        assert.equal(req.headers.authorization, 'Bearer renewed');
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-6.2-sol');
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
  const launch = () => launchTestExtension(extension, {
    profile,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP auth.openai.com 127.0.0.1:' + consentServer.address().port,
      '--ignore-certificate-errors-spki-list=' + spki],
  });
  await copyTestExtension(extension);
  // Drop reader notifications in this fixture while leaving detail requests and the panel connected.
  await appendFile(join(extension, 'client.js'), `{
    const subscribe = PiBrowser.subscribe;
    PiBrowser.subscribe = listener => subscribe(event => {
      if (document.documentElement?.hasAttribute('data-miss-task-updates') &&
          ['message', 'sessions', 'interaction'].includes(event.type)) {
        if (event.type === 'sessions') document.documentElement.setAttribute('data-miss-task-updates', 'dropped');
        return;
      }
      listener(event);
    });
  }`);
  context = await launch();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // Node URL treats the extension scheme as opaque.
  const extensionOrigin = 'chrome-extension://' + new URL(worker.url()).host + '/';
  const cachedGo = resolve('.cache/toolchains/go/bin/go');
  const go = process.env.GO || await access(cachedGo).then(() => cachedGo, () => 'go');
  const binary = join(root, 'check-host');
  execFileSync(go, ['test', '-c', '-ldflags', '-X margin.local/connect.origins=' + extensionOrigin, '-o', binary], { cwd: 'companion' });
  // Exercise the Windows upgrade UI without touching a user's existing host.
  const upgrade = await context.newPage();
  await upgrade.addInitScript(() => {
    chrome.runtime.getPlatformInfo = async () => ({ os: 'win' });
    chrome.runtime.sendNativeMessage = async (_host, command) => {
      if (command.op !== 'capabilities') throw new Error('Unexpected credential access on an obsolete host.');
      return { error: 'Unsupported Margin Connect operation.' };
    };
  });
  await upgrade.route('**/providers/download.json', route => route.fulfill({ json: { win: 'providers/Margin-Connect-Windows.exe' } }));
  await upgrade.goto(extensionOrigin + 'connect.html?provider=deepseek');
  await expect(upgrade.locator('#status')).toContainText('Update Margin Connect');
  await expect(upgrade.getByRole('link', { name: 'Download Margin Connect for Windows' })).toHaveAttribute('href', /Windows\.exe$/);
  await expect(upgrade.locator('#key')).toBeHidden();
  await upgrade.close();
  const panel = await context.newPage();
  await panel.goto(extensionOrigin + 'sidepanel.html');
  // Close a real port on the background end, where its onDisconnect listener will not run.
  const staleName = 'pi-sources/' + 'a'.repeat(32);
  await worker.evaluate(name => chrome.runtime.onConnect.addListener(port => {
    if (port.name !== name) return;
    port.onMessage.addListener(() => port.disconnect());
    port.postMessage('registered');
  }), staleName);
  const stale = await panel.evaluateHandle(name => {
    const port = chrome.runtime.connect({ name });
    const fixture = { port, registered: false, closed: false };
    port.onMessage.addListener(message => { if (message === 'registered') fixture.registered = true; });
    port.onDisconnect.addListener(() => { fixture.closed = true; });
    return fixture;
  }, staleName);
  await expect.poll(() => stale.evaluate(fixture => fixture.registered)).toBe(true);
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
  await page.getByRole('button', { name: 'Connect an account to send' }).click();
  const setup = await setupOpening;
  await setup.getByRole('link', { name: 'ChatGPT subscription' }).click();
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
  await expect(setup.locator('#status')).toHaveText('The OpenAI token endpoint returned HTTP 403.');
  await expect(draft).toHaveValue('Keep my question.');
  denyToken = false;
  async function approveSavedClient(view) {
    const opening = consentOpening();
    await view.getByRole('button', { name: 'Continue with ChatGPT' }).click();
    const tab = await opening;
    await expect(tab).toHaveTitle('Fixture consent');
    assert.equal(pending.get('client_id'), clientId);
    await tab.goto(callback().href).catch(() => {});
  }
  await approveSavedClient(setup);
  await expect(setup.locator('#status')).toContainText('could not be verified');
  assert.equal(calls, 0);
  invalidNonce = false;
  await approveSavedClient(setup);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Keep my question.');
  assert.equal(calls, 0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const detail = async () => panel.evaluate(async () => {
    const [entry] = (await PiBrowser.request('browse')).sessions;
    return entry && PiBrowser.request('detail', { sessionId: entry.id });
  });
  await expect.poll(async () => { const entry = await detail(); if (entry?.error) throw new Error(entry.error); return JSON.stringify({ calls, status: entry?.status, messages: entry?.messages, error: entry?.error }); }).toContain('First passage');
  await expect(page.getByText('First passage', { exact: true })).toBeVisible();
  await expect(page.locator('#activity')).toBeVisible();
  await page.bringToFront();
  await draft.fill('Unsent follow-up');
  await stale.evaluate(fixture => fixture.port.postMessage('close'));
  await expect.poll(() => stale.evaluate(fixture => fixture.closed)).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-miss-task-updates', ''));
  release();
  await expect.poll(async () => (await detail())?.status).toBe('completed');
  assert.match(JSON.stringify((await detail()).messages), /First passage discussed\./);
  await expect(page.locator('html')).toHaveAttribute('data-miss-task-updates', 'dropped');
  await expect(page.locator('#activity')).toBeHidden();
  await expect(page.getByText('First passage discussed.', { exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Unsent follow-up');
  await page.evaluate(() => document.documentElement.removeAttribute('data-miss-task-updates'));
  assert.equal(refreshes, 1); assert.equal(calls, 1);
  // Exercise disconnection while another authorized stream is still open.
  const control = await context.newPage();
  await control.goto(extensionOrigin + 'connect.html');
  const sessionId = (await detail()).id;
  const deepseek = await context.newPage();
  await deepseek.goto(extensionOrigin + 'options.html');
  await deepseek.getByRole('link', { name: 'Manage DeepSeek connection' }).click();
  const connectKey = async key => {
    await deepseek.getByLabel('DeepSeek API key').fill(key);
    await deepseek.getByRole('button', { name: 'Connect DeepSeek' }).click();
  };
  await connectKey('invalid-fixture');
  await expect(deepseek.locator('#status')).toContainText('declined');
  await connectKey('fixture-deepseek');
  await expect(deepseek.locator('#status')).toHaveText('Connected to DeepSeek.');
  const modelIds = () => panel.evaluate(async () => (await PiBrowser.request('models')).models.map(model => model.id));
  assert.deepEqual(await modelIds(), [...availableModels, 'deepseek-flash']);
  const switchModel = id => panel.evaluate(({ sessionId, id }) =>
    PiBrowser.request('model', { sessionId, model: { id } }), { sessionId, id });
  await switchModel('deepseek-flash');
  await panel.evaluate(sessionId => PiBrowser.request('send', { sessionId, text: 'Read with DeepSeek' }), sessionId);
  await expect.poll(async () => { const entry = await detail(); if (entry.error) throw new Error(entry.error); return entry.status; }).toBe('completed');
  assert.match(JSON.stringify((await detail()).messages), /DeepSeek discussed the passage/);
  await switchModel('gpt-6.2-sol');
  await panel.evaluate(sessionId => PiBrowser.request('send', { sessionId, text: 'Check rate limit' }), sessionId);
  await expect.poll(async () => (await detail()).error).toMatch(/429.*usage limits/);
  await panel.evaluate(sessionId => PiBrowser.request('send', { sessionId, text: 'Keep my question in this follow-up.' }), sessionId);
  await expect.poll(() => calls).toBe(2);
  await deepseek.getByRole('button', { name: 'Disconnect account' }).click();
  await expect(deepseek.getByLabel('DeepSeek API key')).toBeVisible();
  assert.deepEqual(await modelIds(), availableModels);
  assert.equal((await detail()).status, 'running');
  assert.equal(streamClosed, false);
  await control.getByRole('button', { name: 'Disconnect account' }).click();
  await expect.poll(() => streamClosed).toBe(true);
  await expect.poll(async () => (await detail()).status).toBe('cancelled');
  await expect(control.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  assert.ok(revoked);
  // Login warms the directory even with no discussion view to request it.
  await panel.close();
  await page.close();
  const previewIds = view => view.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'pi-sources', action: 'modelPreview' });
    return reply.result.models.map(model => model.id);
  });
  assert.deepEqual(await previewIds(control), []);
  await approveSavedClient(control);
  await expect(control.locator('#status')).toContainText('reader@example.test');
  await expect.poll(() => previewIds(control)).toEqual(availableModels);
  await connectKey('fixture-deepseek');
  await expect.poll(() => previewIds(control)).toEqual([...availableModels, 'deepseek-flash']);
  const stored = await control.evaluate(() => chrome.storage.local.get(null));
  assert.ok(!JSON.stringify(stored).includes('fixture-deepseek'));
  await context.close();
  context = await launch();
  const settings = await context.newPage();
  await settings.goto(extensionOrigin + 'connect.html');
  await expect(settings.locator('#status')).toContainText('reader@example.test');
  assert.deepEqual(await previewIds(settings), [...availableModels, 'deepseek-flash']);
  await settings.getByRole('button', { name: 'Disconnect account' }).click();
  await expect(settings.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  assert.ok(revoked);
  await expect.poll(() => previewIds(settings)).toEqual(['deepseek-flash']);
  await settings.goto(extensionOrigin + 'connect.html?provider=deepseek');
  await expect(settings.locator('#status')).toHaveText('Connected to DeepSeek.');
  await assert.rejects(access(join(dir, 'session.json')), { code: 'ENOENT' });
  await assert.rejects(access(join(dir, 'DeepSeek/session.json')), { code: 'ENOENT' });
  console.log('Native setup, OAuth verification, draft return, refresh, DeepSeek streaming, independent connections, restart and revocation passed.');
} finally {
  release?.();
  await context?.close();
  consentServer?.closeAllConnections();
  consentServer?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const fixtureHost = join(root, 'Margin', 'Connect', 'MarginConnect');
  if (await access(fixtureHost).then(() => true, () => false)) execFileSync(fixtureHost, ['--clean-fixture', root]);
  await rm(root, { recursive: true, force: true });
  if (failure) throw failure;
}
