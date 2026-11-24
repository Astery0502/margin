import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const temp = await mkdtemp(join(tmpdir(), 'margin-local-'));
const extension = resolve('dist');
let context;
try {
  context = await chromium.launchPersistentContext('', { headless: true,
    executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const details = await context.newPage();
  await details.goto('edge://extensions/?id=' + extensionId);
  const toggle = details.locator('standard-row').filter({ hasText: /允许访问文件 URL|Allow access to file URLs/ }).locator('fluent-switch');
  const allowed = () => details.locator('standard-row').filter({ hasText: /允许访问文件 URL|Allow access to file URLs/ }).locator('fluent-switch').evaluate(element => element.checked);
  if (!await allowed()) await toggle.click();
  await expect.poll(allowed).toBe(true);
  const path = join(temp, 'local article.html');
  await writeFile(path, '<title>Local article</title><p>A local passage to discuss in Margin.</p>');
  const html = await context.newPage();
  await html.goto(pathToFileURL(path).href);
  await html.locator('body > p').evaluate(p => {
    const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await html.getByRole('button', { name: 'Quick', exact: true }).click();
  const draft = html.getByRole('textbox', { name: 'Discussion draft' });
  await draft.fill('Discuss my local document');
  const connecting = context.waitForEvent('page');
  await html.getByRole('button', { name: 'Connect ChatGPT to send' }).click();
  const setup = await connecting;
  await expect(draft).toHaveValue('Discuss my local document');
  await expect(setup.locator('#status')).toContainText('Margin Connect');
  await setup.close();

  const pdf = await context.newPage();
  const url = new URL('./fixtures/sample.pdf', import.meta.url).href;
  await pdf.goto(url);
  const opening = context.waitForEvent('page');
  await pdf.getByRole('button', { name: 'Open PDF in Margin' }).click();
  const reader = await opening;
  await expect(reader.locator('#page-count')).toHaveText('/ 14');
  await pdf.close();
  await reader.reload();
  await expect(reader.locator('#page-count')).toHaveText('/ 14');
  await reader.close();
  await details.bringToFront();
  await toggle.click();
  await expect.poll(allowed).toBe(false);
  const blocked = await context.newPage();
  await blocked.goto(new URL('pdf/reader.html?url=' + encodeURIComponent(url), worker.url()).href);
  await expect(blocked.locator('#load-error-text')).toContainText('Allow access to file URLs');
  console.log('Local HTML drafts, drafts retained during connection, local PDFs, reload and permission denial passed.');
} finally { await context?.close(); await rm(temp, { recursive: true, force: true }); }
