import { copyTestExtension } from './fixtures/native-extension.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const sample = await readFile(new URL('./fixtures/sample.pdf', import.meta.url));
let authenticatedReads = 0;
const server = createServer((req, res) => {
  if (req.url === '/sample.pdf') {
    if (!req.headers.cookie?.includes('reader=1')) { res.writeHead(401).end(); return; }
    authenticatedReads++;
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': sample.length, 'Cache-Control': 'no-store' }).end(sample);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'reader=1; HttpOnly; SameSite=Lax' });
  res.end('<title>Sample article</title><p>Select part of this article to discuss its meaning.</p>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const temp = await mkdtemp(join(tmpdir(), 'margin-reader-'));
let context;
try {
  const extension = join(temp, 'extension');
  await copyTestExtension(extension);
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 320, height: 560 });
  await settings.goto(new URL('options.html', worker.url()).href);
  await expect(settings.getByLabel('Default agent')).toBeHidden();
  const chooseModel = settings.getByRole('button', { name: /^Preferred model:/ });
  await chooseModel.click();
  const modelList = settings.getByRole('listbox', { name: 'Preferred model' });
  await expect(modelList).toBeVisible();
  assert.ok((await modelList.boundingBox()).height <= 112);
  const filter = settings.getByRole('searchbox', { name: 'Filter models' });
  await filter.fill('no matching model');
  await expect(settings.getByText('No matching models')).toBeVisible();
  await filter.fill('GPT-4.1');
  await filter.press('ArrowDown');
  await modelList.press('Enter');
  await expect(chooseModel).toHaveAccessibleName('Preferred model: GPT-4.1');
  await expect(settings.getByLabel('Reasoning')).toBeHidden();
  await settings.getByRole('button', { name: 'Add agent' }).click();
  await expect(settings.getByLabel('Default agent')).toBeVisible();
  await chooseModel.click();
  await filter.fill('GPT-4.1');
  await filter.press('Enter');
  await settings.getByLabel('Fast mode').uncheck();
  await settings.getByRole('button', { name: 'Save agent settings' }).click();
  await expect(settings.locator('#agent-form').getByRole('status')).toHaveText('Agent settings saved.');
  await settings.reload();
  await expect(chooseModel).toHaveAccessibleName('Preferred model: GPT-4.1');
  await expect(settings.getByLabel('Fast mode')).not.toBeChecked();
  await chooseModel.click();
  await filter.press('Escape');
  await expect(chooseModel).toBeFocused();
  assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth), 320);
  await settings.close();
  const invalid = await context.newPage();
  await invalid.goto(new URL('pdf/reader.html', worker.url()).href);
  await expect(invalid.locator('body')).toHaveText(/Open a PDF/);
  const page = await context.newPage();
  await page.goto(origin);
  const native = await context.newPage();
  await native.goto(origin + '/sample.pdf');
  const opening = context.waitForEvent('page');
  await native.getByRole('button', { name: 'Open PDF in Margin' }).click();
  const reader = await opening;
  await expect(reader.locator('#page-count')).toHaveText('/ 14');
  await expect(reader.locator('#loading')).toBeHidden();
  assert.equal(authenticatedReads, 2);
  await native.close();
  await context.clearCookies();
  await reader.reload();
  await expect(reader.locator('#page-count')).toHaveText('/ 14');
  await reader.locator('#page').fill('2');
  await reader.locator('#page').press('Tab');
  const line = reader.locator('.page[data-page-number="2"] .textLayer span').filter({ hasText: /.{50}/ }).first();
  await line.scrollIntoViewIfNeeded();
  const passage = await line.textContent();
  const rect = await line.boundingBox();
  await reader.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await reader.mouse.down();
  await reader.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 12 });
  await reader.mouse.up();
  await reader.getByRole('button', { name: 'Full', exact: true }).click();
  const draft = reader.getByRole('textbox', { name: 'Discussion draft' });
  await draft.fill('Why does the author make this distinction?');
  await expect(draft).toBeFocused();
  await reader.getByRole('button', { name: 'Add image' }).click();
  await reader.mouse.move(200, 160);
  await reader.mouse.down();
  await reader.mouse.move(320, 220, { steps: 4 });
  await reader.mouse.up();
  await expect(reader.getByText('1 image attached', { exact: true })).toBeVisible();
  await expect(reader.locator('#attached-quote')).toBeHidden();
  await reader.keyboard.press('Escape');
  await expect(draft).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Return to question' })).toHaveCount(0);
  await reader.locator('#zoom').selectOption('1.5');
  await reader.getByRole('button', { name: 'Rotate', exact: true }).click();
  await reader.locator('#page').fill('8');
  await reader.locator('#page').press('Tab');
  await expect(reader.locator('#page')).toHaveValue('8');
  await reader.getByRole('button', { name: 'Return to passage' }).click();
  await expect(reader.locator('#page')).toHaveValue('2');
  await expect(reader.locator('.page[data-page-number="2"] .textLayer span').filter({ hasText: passage }).first()).toBeInViewport();
  await reader.close();
  await expect.poll(() => worker.evaluate(() => caches.keys())).toEqual([]);
  assert.deepEqual(errors, []);
  console.log('Authenticated PDF handoff, cached reload, Full draft, transformed passage location, and reader cleanup passed.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
