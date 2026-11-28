import { launchTestExtension } from './fixtures/native-extension.mjs';
import { cp, writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = await mkdtemp(join(tmpdir(), 'margin-discussions-'));
const extension = join(root, 'extension');
const pdf = await readFile(new URL('./fixtures/sample.pdf', import.meta.url));
let modelIds = ['gpt-6.2-sol'], modelGate;
const server = createServer(async (req, res) => {
  if (req.url === '/models') {
    await modelGate?.promise;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ modelIds }));
    return;
  }
  if (req.url === '/sample.pdf') res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length }).end(pdf);
  else res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Example article</title><p>First passage on this page.</p><p>Second passage on this page.</p>');
});
let context, attached;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await cp('dist', extension, { recursive: true });
  const content = join(extension, 'content.js');
  await writeFile(content, `if (location.pathname === '/unresponsive') {
    chrome.runtime.onMessage.addListener(message => message.action === 'identity' ? true : undefined);
  } else {${await readFile(content, 'utf8')} }`);
  await build({ entryPoints: ['extension/agents/worker.js', 'extension/background.js'], outbase: 'extension', outdir: extension, bundle: true, platform: 'browser', format: 'esm',
    plugins: [{ name: 'controlled-replies', setup(build) {
      build.onResolve({ filter: /providers\/stream\.js$/ }, () => ({ path: resolve('checks/fixtures/stream.js') }));
      build.onResolve({ filter: /(?:^\.\/|providers\/)native\.js$/ }, () => ({ path: 'native', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const nativeHost = 'dev.margin.test_connect';
        export const hostMissing = () => false;
        export const outdatedHost = () => false;
        export const nativeCommand = (op, fields) => ({ ...fields, op });
        export async function nativeRequest(op) {
          if (op === 'deepseek-status') return { connected: false };
          if (op === 'status') return { connected: true, selected: 'reader', generation: 1 };
          return { connected: true, ...(await (await fetch(${JSON.stringify(origin + '/models')})).json()) };
        }` }));
    } }] });
  context = await launchTestExtension(extension, {
    profile: join(root, 'profile'), args: ['--use-fake-device-for-media-stream', '--remote-debugging-port=0'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const errors = [];
  context.on('weberror', event => errors.push(event.error().message));
  const settings = await context.newPage();
  await settings.goto(new URL('options.html', worker.url()).href);
  await expect(settings.locator('.model-field').getByText('GPT-6.2 Sol', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: /^Preferred model:/ })).toHaveCount(0);
  await settings.getByLabel('Read and write notes for this page').check();
  await settings.getByLabel('Delegate reading tasks on this page').check();
  await settings.getByText('Save agent settings').click();
  await expect(settings.locator('#status')).toHaveText('Agent settings saved.');
  const cdp = await context.newCDPSession(page);
  let versionId;
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    const match = versions.find(v => v.scriptURL === worker.url() && v.runningStatus === 'running');
    if (match) versionId = match.versionId;
  });
  await cdp.send('ServiceWorker.enable');
  await page.goto(origin);
  let panel = await context.newPage();
  await panel.goto(new URL('sidepanel.html', worker.url()).href);
  const rpc = (action, values = {}) => panel.evaluate(([name, data]) => PiBrowser.request(name, data), [action, values]);
  const listed = async () => (await rpc('browse', {})).sessions;
  async function openDraft(index, mode) {
    await page.bringToFront();
    await page.locator('body > p').nth(index).evaluate(p => {
      const range = document.createRange(); range.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('toolbar', { name: 'Discuss passage' }).getByRole('button', { name: mode, exact: true }).click();
  }
  async function compose(index, mode, question) {
    await openDraft(index, mode);
    const draft = page.getByRole('textbox', { name: 'Discussion draft' });
    await draft.fill(question);
    await draft.press('Enter');
  }

  async function expireListing() {
    await settings.evaluate(async () => {
      const { modelListing } = await chrome.storage.local.get('modelListing');
      await chrome.storage.local.set({ modelListing: { ...modelListing, expires: 0 } });
    });
  }
  const modelSummary = page.getByRole('button', { name: /^Model settings:/ });
  const reasoning = page.getByRole('combobox', { name: 'Reasoning level' });
  const chooseModel = page.getByRole('button', { name: /^Model:/ });
  const quickDraft = page.getByRole('textbox', { name: 'Discussion draft' });
  modelIds.push('o3');
  await settings.evaluate(() => chrome.storage.local.remove('modelListing'));
  modelGate = Promise.withResolvers();
  await openDraft(0, 'Quick');
  await modelSummary.click();
  await expect(chooseModel).toHaveCount(0);
  await reasoning.selectOption('max');
  await expect(modelSummary).toHaveAccessibleName(/Reasoning: Max/);
  await expect(modelSummary.locator('.reasoning-bars rect.active')).toHaveCount(5);
  await quickDraft.fill('Dismiss this question while the directory is loading');
  await quickDraft.press('Enter');
  await quickDraft.press('Escape');
  modelGate.resolve();
  await rpc('models');

  // A catalog update must not move the keyboard highlight back to the saved model.
  await expireListing();
  modelGate = Promise.withResolvers();
  await openDraft(0, 'Quick');
  await modelSummary.click();
  await chooseModel.click();
  const modelList = page.getByRole('listbox', { name: 'Model', exact: true });
  await modelList.press('End');
  await expect(modelList).toHaveValue('o3');
  modelIds.push('gpt-5', 'gpt-4.1', 'gpt-4.1-mini');
  modelGate.resolve();
  await expect(page.getByRole('searchbox', { name: 'Filter models' })).toBeVisible();
  await modelList.press('Enter');
  await expect(modelSummary).toHaveAccessibleName(/openai \/ o3/);
  assert.deepEqual(await listed(), []);
  await quickDraft.press('Escape');

  // A cached choice remains editable while a refresh removes it.
  await expireListing();
  modelGate = Promise.withResolvers();
  await openDraft(0, 'Quick');
  await quickDraft.fill('Keep this draft');
  await modelSummary.click();
  await chooseModel.click();
  await page.getByRole('option', { name: 'o3', exact: true }).click();
  modelIds = ['gpt-6.2-sol', 'gpt-5'];
  modelGate.resolve();
  await expect(page.getByText(/o3 is no longer available/)).toBeVisible();
  await expect(quickDraft).toHaveValue('Keep this draft');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(modelSummary).toHaveAccessibleName(/openai \/ o3/);
  await quickDraft.press('Escape');

  async function captureImage() {
    await page.getByRole('button', { name: 'Add image' }).click();
    await expect(page.getByRole('dialog', { name: 'Select image region' })).toBeVisible();
    await page.mouse.move(15, 15);
    await page.mouse.down();
    await page.mouse.move(220, 65, { steps: 6 });
    await page.mouse.up();
    await expect(quickDraft).toBeVisible();
  }

  for (const dismissal of ['Escape', 'outside click']) {
    await openDraft(0, 'Quick');
    await quickDraft.fill('Unsent image question');
    await captureImage();
    const expandedQuote = await page.locator('#attached-quote').isVisible();
    if (dismissal === 'Escape') await quickDraft.press('Escape');
    else await page.mouse.click(8, 8);
    await expect(quickDraft).toBeHidden();
    await openDraft(1, 'Quick');
    await expect(page.locator('#attached-quote').last()).toHaveText('Second passage on this page.');
    assert.deepEqual({
      expandedQuote, nextText: await quickDraft.inputValue(),
      showsAttachments: await page.locator('#images').isVisible(),
    }, { expandedQuote: false, nextText: '', showsAttachments: false });
    await quickDraft.press('Escape');
  }
  // Select a model and edit its settings before the directory request can finish.
  await expireListing();
  modelGate = Promise.withResolvers();
  await openDraft(0, 'Quick');
  await modelSummary.click();
  await expect(page.getByRole('combobox', { name: 'Agent', exact: true })).toHaveCount(0);
  await chooseModel.click();
  await page.getByRole('option', { name: 'GPT-5', exact: true }).click();
  await modelSummary.click();
  assert.ok(await reasoning.evaluate(field => field.clientHeight <= parseFloat(getComputedStyle(field.parentElement).lineHeight) + 14),
    'The reasoning value and its disclosure arrow should fit on one line.');
  await reasoning.selectOption('low');
  await expect(modelSummary).toHaveAccessibleName(/Reasoning: Low/);
  await modelSummary.click();
  await page.getByLabel('Fast mode').uncheck();
  await expect(modelSummary).toHaveAccessibleName(/GPT-5.*Reasoning: Low.*Speed: Provider default/);
  modelGate.resolve();
  await rpc('models');
  await modelSummary.click();
  const discussion = page.locator('.floating-dialog:visible');
  const beforeCapture = await discussion.boundingBox();
  await captureImage();
  await expect(page.locator('#attached-quote')).toBeHidden();
  await expect(page.getByAltText('Attached image 1')).toBeHidden();
  await page.getByText('1 image attached', { exact: true }).click();
  await expect(page.getByAltText('Attached image 1')).toBeVisible();
  const afterCapture = await discussion.boundingBox();
  assert.equal(afterCapture.x, beforeCapture.x);
  assert.equal(afterCapture.y, beforeCapture.y);
  await quickDraft.fill('Explain this figure');
  await quickDraft.press('Enter');
  await expect.poll(async () => (await listed())[0]?.status).toBe('completed');
  const photoDetail = await rpc('detail', { sessionId: (await listed())[0].id });
  await assert.rejects(rpc('model', { sessionId: photoDetail.id, model: { id: 'unlisted-model' } }), /no longer available/);
  assert.equal((await rpc('get', { sessionId: photoDetail.id })).model.id, 'gpt-5');
  assert.equal(photoDetail.model.id, 'gpt-5');
  assert.equal(photoDetail.messages.find(message => message.role === 'user').presentation.passage.text, 'First passage on this page.');
  assert.equal(photoDetail.thinking, 'low');
  assert.equal(photoDetail.tier, 'default');
  assert.match(JSON.stringify(photoDetail.messages.at(-1)?.content), /equation/);
  await expect(page.locator('.katex')).toBeVisible();
  // Cancelling the region selector returns to the same input; dismissing the
  // discussion drops the follow-up, while its submitted history stays intact.
  await quickDraft.fill('Unsent follow-up');
  await captureImage();
  await page.getByRole('button', { name: 'Add image' }).click();
  await page.keyboard.press('Escape');
  await expect(quickDraft).toHaveValue('Unsent follow-up');
  await expect(page.getByText('1 image attached', { exact: true })).toBeVisible();
  const reopenQuick = page.locator('[data-pi-session-id]').getByRole('button', { name: 'Quick', exact: true });
  await page.mouse.click(8, 8);
  await reopenQuick.click();
  await expect(quickDraft).toHaveValue('');
  await expect(page.locator('#images')).toBeHidden();
  await quickDraft.fill('  \n');
  await quickDraft.press('Escape');
  await reopenQuick.click();
  await expect(quickDraft).toHaveValue('');
  const answer = page.getByText('this equation', { exact: true });
  const box = await answer.boundingBox();
  await page.mouse.move(box.x, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Add to conversation' }).click();
  await expect(quickDraft).toHaveValue(/Quoted from Pi:[\s\S]*equation/);
  const [quick] = await listed();
  const quickExport = await rpc('exportPage', { sourceId: page.url() });
  assert.equal(quickExport.snapshots.length, 0);
  assert.ok(quickExport.messages.some(entry => entry.message.content?.some(block => block.type === 'image')));
  await rpc('deleteDiscussions', { sessionIds: [quick.id] });
  await expect(quickDraft).toHaveCount(0);

  await compose(0, 'Full', 'Give a long response');
  await expect.poll(async () => (await listed())[0]?.status, { timeout: 10000 }).toBe('running');
  const first = (await listed())[0].id;
  await expect.poll(async () => JSON.stringify((await rpc('detail', { sessionId: first })).messages)).toContain('Streaming');
  await panel.close();
  const input = page.getByRole('textbox', { name: 'Discussion draft' });
  await input.fill('Please queue the next question');
  await input.press('Tab');
  // Wait for acceptance before editing the next unsent draft.
  await expect(input).toHaveValue('');
  await input.fill('Keep this handoff draft');
  const opening = context.waitForEvent('page', { timeout: 2000 }).catch(() => null);
  await page.getByRole('button', { name: 'Open in side panel' }).click();
  panel = await opening;
  if (!panel) {
    const port = (await readFile(join(root, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0];
    attached = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    panel = attached.contexts().flatMap(ctx => ctx.pages()).find(p => p.url().endsWith('/sidepanel.html'));
  }
  assert.ok(panel, 'The native side panel opened');
  await expect(panel.getByRole('textbox', { name: 'Discussion draft' })).toHaveValue('Keep this handoff draft');
  await expect.poll(async () => (await rpc('detail', { sessionId: first })).queuedMessages?.followUp).toEqual(['Please queue the next question']);
  await expect.poll(() => versionId).toBeTruthy();
  const unresponsive = await context.newPage();
  await unresponsive.goto(origin + '/unresponsive');
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  await expect.poll(async () => (await rpc('get', { sessionId: first })).status).toBe('running');
  await expect(panel.getByRole('button', { name: 'Stop task' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Stop task' }).click();
  await expect.poll(async () => (await listed())[0].status).toBe('cancelled');
  await expect(panel.locator('#source-card')).toBeHidden();
  await panel.getByRole('button', { name: 'Locate passage', exact: true }).click();
  await expect(page.locator('body > p').first()).toBeInViewport();

  await context.grantPermissions(['microphone']);
  await page.bringToFront();
  await page.locator('[data-pi-session-id]').getByRole('button', { name: 'Full', exact: true }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
  assert.equal((await panel.evaluate(id => PiBrowser.voice('status', id), first)).state, 'idle');
  await page.getByRole('button', { name: 'Open in side panel' }).click();
  await expect(panel.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect(panel.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();

  await compose(1, 'Full', 'Explain the next paragraph');
  await expect.poll(async () => (await listed()).filter(item => item.status === 'completed').length).toBe(1);
  const second = (await listed()).find(item => item.id !== first);
  assert.equal(second.sessionId, (await rpc('get', { sessionId: first })).sessionId);
  const secondDetail = await rpc('detail', { sessionId: second.id });
  assert.match(JSON.stringify(secondDetail.messages), /Answer with 1 document snapshot/);
  assert.doesNotMatch(JSON.stringify(secondDetail.messages), /Give a long response/);
  await rpc('model', { sessionId: second.id, thinking: 'low', tier: 'default' });
  assert.equal((await rpc('get', { sessionId: first })).thinking, 'low');
  await rpc('send', { sessionId: second.id, text: 'Take a brief pause' });
  await rpc('send', { sessionId: second.id, text: 'Guide the next model call', mode: 'steer' });
  await rpc('send', { sessionId: second.id, text: 'Queue this follow-up', mode: 'followUp' });
  await expect.poll(async () => (await rpc('get', { sessionId: second.id })).status, { timeout: 10000 }).toBe('completed');
  const turns = (await rpc('detail', { sessionId: second.id })).messages.filter(m => m.role === 'user').map(m => m.presentation.text);
  assert.deepEqual(turns.slice(-3), ['Take a brief pause', 'Guide the next model call', 'Queue this follow-up']);
  await rpc('send', { sessionId: second.id, text: 'Please ask for clarification' });
  await expect.poll(async () => (await rpc('detail', { sessionId: second.id })).interactionRequests?.length).toBe(1);
  const [request] = (await rpc('detail', { sessionId: second.id })).interactionRequests;
  await rpc('interaction', { sessionId: second.id, requestId: request.id, answer: { value: 'The second one' } });
  await expect.poll(async () => (await rpc('get', { sessionId: second.id })).status).toBe('completed');
  await rpc('send', { sessionId: second.id, text: 'Please save a note' });
  await expect.poll(async () => (await rpc('storage', { sourceId: page.url() })).workingFiles).toBe(1);
  await expect.poll(async () => (await rpc('get', { sessionId: second.id })).status).toBe('completed');
  await rpc('archivePage', { sourceId: page.url(), archived: true });
  assert.equal((await listed()).length, 0);
  await rpc('archivePage', { sourceId: page.url(), archived: false });
  assert.equal((await rpc('browse', { query: 'Example article' })).total, 2);
  const exported = await rpc('exportPage', { sourceId: page.url() });
  assert.equal(exported.snapshots.length, 1);
  await rpc('send', { sessionId: second.id, text: 'Delegate a reading task' });
  await expect.poll(async () => (await listed()).filter(item => item.parentId).length).toBe(1);
  await expect.poll(async () => (await listed()).filter(item => item.status === 'running').length).toBe(0);
  const branch = await rpc('fork', { sessionId: second.id });
  assert.notEqual(branch.sessionId, second.sessionId);
  assert.ok((await rpc('detail', { sessionId: branch.id })).messages.length);
  await rpc('deleteDiscussions', { sessionIds: [branch.id, (await listed()).find(item => item.parentId).id] });
  const panelDraft = panel.getByRole('textbox', { name: 'Discussion draft' });
  const backToList = panel.getByRole('button', { name: 'Back to list' });
  await panelDraft.fill('Keep this draft while browsing');
  await panel.getByRole('button', { name: 'Archive', exact: true }).click();
  const hint = panel.locator('#icon-hint');
  const restore = panel.getByRole('button', { name: 'Restore', exact: true });
  await panelDraft.hover();
  await restore.hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Restore');
  await panel.keyboard.press('Escape');
  await expect(hint).toBeHidden();
  await restore.click();
  await expect(panel.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled();
  const readingSize = await panel.locator('#messages').evaluate(node => getComputedStyle(node).fontSize);
  await backToList.click();
  await expect(panelDraft).toBeHidden();
  await expect(panel.getByRole('searchbox')).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Delete', exact: true })).toBeHidden();
  const firstRow = panel.locator(`.discussion[data-session-id="${first}"]`);
  await expect(firstRow).toBeVisible();
  assert.equal(await firstRow.locator('.discussion-title').evaluate(node => getComputedStyle(node).fontSize), readingSize);
  await panel.getByRole('button', { name: 'Search discussions' }).click();
  const filter = panel.getByRole('searchbox', { name: 'Find discussions' });
  await filter.fill('Example article');
  await firstRow.locator('.discussion-open').click();
  await expect(panelDraft).toHaveValue('Keep this draft while browsing');
  await expect(filter).toBeHidden();
  await backToList.click();
  await expect(filter).toHaveValue('Example article');
  await expect(firstRow.locator('.discussion-open')).toHaveAttribute('aria-current', 'true');
  const locate = firstRow.getByRole('button', { name: 'Locate passage' });
  await locate.hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Locate');
  await locate.click();
  await firstRow.getByRole('button', { name: 'Archive discussion' }).click();
  await expect(firstRow).toBeHidden();
  await panel.getByRole('button', { name: 'Include archived discussions' }).click();
  await firstRow.getByRole('button', { name: 'Restore discussion' }).click();
  await expect(firstRow.getByRole('button', { name: 'Archive discussion' })).toBeVisible();
  await panel.getByRole('button', { name: 'Select discussions' }).click();
  await firstRow.getByRole('checkbox').check();
  await expect(panel.locator('#selection-count')).toHaveText('1 selected');
  await expect(panel.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Select all' }).click();
  await expect(panel.locator('#selection-count')).toHaveText('2 selected');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(firstRow.getByRole('checkbox')).toBeHidden();
  await panel.getByRole('radio', { name: 'All', exact: true }).check();
  await panel.getByRole('button', { name: 'Page summary: Example article' }).click();
  const clearFiles = panel.getByRole('button', { name: 'Clear working files' });
  panel.once('dialog', dialog => dialog.accept());
  await clearFiles.click();
  await expect(clearFiles).toBeHidden();
  assert.equal((await rpc('storage', { sourceId: page.url() })).workingFiles, 0);
  assert.equal((await listed()).length, 2);
  const downloading = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export discussions' }).click();
  const download = await downloading;
  const exportedFile = join(root, 'discussions.json');
  await download.saveAs(exportedFile);
  await panel.keyboard.press('Escape');
  const twin = await context.newPage();
  await twin.goto(page.url());
  await page.goto(page.url() + '#passage');
  await page.reload();
  await expect.poll(async () => (await listed()).length).toBe(2);
  await page.goto(origin + '/second');
  await compose(0, 'Quick', 'Discuss the second article');
  await expect.poll(async () => (await listed()).length).toBe(3);
  await page.goBack();
  await expect(page.getByRole('button', { name: /2 saved discussions on this page/ })).toBeVisible();
  await page.goto(origin + '/second');
  await page.close();
  await expect.poll(async () => (await listed()).map(item => item.sourceId)).toEqual([twin.url(), twin.url()]);
  assert.equal(JSON.parse(await readFile(exportedFile, 'utf8')).discussions.length, 2);
  await twin.close();
  await expect.poll(async () => (await listed()).length).toBe(0);
  await unresponsive.close();
  // Use the same controlled runtime through the PDF reader and native side panel.
  modelIds = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-6.1-sol', 'gpt-4o-mini'];
  await expireListing();
  await rpc('models');
  const native = await context.newPage();
  await native.goto(origin + '/sample.pdf');
  const openingPdf = context.waitForEvent('page');
  await native.getByRole('button', { name: 'Open PDF in Margin' }).click();
  const reader = await openingPdf;
  const line = reader.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: /.{20}/ }).first();
  await line.evaluate(span => {
    const r = document.createRange(); r.selectNodeContents(span); getSelection().removeAllRanges(); getSelection().addRange(r);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await reader.getByRole('toolbar', { name: 'Discuss passage' }).getByRole('button', { name: 'Full' }).click();
  const pdfDraft = reader.getByRole('textbox', { name: 'Discussion draft' });
  await pdfDraft.fill('A long response about the PDF');
  const pdfSummary = reader.getByRole('button', { name: /^Model settings:/ });
  await pdfSummary.click();
  const models = reader.getByRole('button', { name: /^Model:/ });
  await models.click();
  const search = reader.getByRole('searchbox', { name: 'Filter models' });
  await search.press('Escape');
  await expect(models).toBeFocused();
  await models.click();
  await search.fill('GPT-4.1');
  await reader.getByRole('option', { name: 'GPT-4.1', exact: true }).click();
  await expect(pdfSummary).toHaveAccessibleName(/GPT-4.1/);
  await expect(reader.getByLabel('Reasoning level')).toBeHidden();
  await pdfSummary.click();
  await expect(pdfDraft).toHaveValue('A long response about the PDF');
  await pdfDraft.press('Enter');
  await expect.poll(async () => (await listed())[0]?.status).toBe('running');
  const pdfId = (await listed())[0].id;
  await expect.poll(async () => JSON.stringify((await rpc('detail', { sessionId: pdfId })).messages)).toContain('Streaming');
  await reader.getByRole('button', { name: 'Open in side panel' }).click();
  await expect(reader.locator('#discussion')).toBeHidden();
  await panel.getByRole('button', { name: 'Stop task' }).click();
  await expect.poll(async () => (await rpc('get', { sessionId: pdfId })).status).toBe('cancelled');
  await reader.locator('#zoom').selectOption('1.5');
  await reader.getByRole('button', { name: 'Rotate', exact: true }).click();
  await reader.locator('#page').fill('8');
  await reader.locator('#page').press('Tab');
  await panel.locator('#source-toggle').click();
  await panel.getByRole('button', { name: 'Locate passage', exact: true }).click();
  await expect(reader.locator('#page')).toHaveValue('1');
  await native.close();
  await rpc('send', { sessionId: pdfId, text: 'A long response to interrupt' });
  await reader.close();
  await expect.poll(async () => (await listed()).length).toBe(0);
  assert.deepEqual(errors, []);
  console.log('Controlled Agent streaming, cross-view stop, shared Full history, tools, page data and cleanup passed.');
} finally {
  modelGate?.resolve();
  await attached?.close();
  await context?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
