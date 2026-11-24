import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
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
let context;
try {
  const extension = resolve('dist');
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
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
  await reader.keyboard.press('Escape');
  await expect(draft).toHaveCount(0);
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
}
