import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const temp = await mkdtemp(join(tmpdir(), 'margin-speech-'));
const audio = join(temp, 'speech.wav');
const extension = join(temp, 'extension');
const model = join(extension, 'dictation/models/Xenova/whisper-tiny/onnx/encoder_model_quantized.onnx');
const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Reading</title><p>Discuss this passage in your own words.</p>'));
let browser;
try {
  await cp(resolve('dist'), extension, { recursive: true });
  await rename(model, model + '.unavailable');
  execFileSync('say', ['-v', 'Samantha', '-o', join(temp, 'speech.aiff'), 'This is a reading test. The book is on the table.']);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', join(temp, 'speech.aiff'), audio]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launchPersistentContext('', {
    headless: true, executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension,
      '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + audio],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const settings = await browser.newPage();
  await settings.goto(new URL('options.html', worker.url()).href);
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('body > p').evaluate(p => {
    const range = document.createRange(); range.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Quick', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Discussion draft' });
  await draft.fill('Notes:');
  const record = page.getByRole('button', { name: 'Record', exact: true });
  async function requestPermission() {
    const opening = browser.waitForEvent('page', { predicate: p => p !== page });
    await record.click();
    const permission = await opening;
    await expect(permission.getByRole('button', { name: 'Allow microphone and start' })).toBeEnabled();
    return permission;
  }
  const dismissed = await requestPermission();
  await dismissed.close();
  await expect(record).toBeEnabled();
  const cancelled = await requestPermission();
  await page.bringToFront();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect.poll(() => cancelled.isClosed()).toBe(true);
  const permission = await requestPermission();
  await browser.grantPermissions(['microphone']);
  await permission.getByRole('button', { name: 'Allow microphone and start' }).click();
  await page.bringToFront();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Return to recording draft' }).click();
  await page.waitForTimeout(4600);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.locator('#voice-audio')).toHaveAttribute('src', /^data:audio/);
  await rename(model + '.unavailable', model);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(draft).toHaveValue(/Notes:\s*[\s\S]*(reading|book|table)/i, { timeout: 90000 });
  const transcript = await draft.inputValue();
  await record.click();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect(draft).toHaveValue(transcript);
  assert.match(transcript, /^Notes:/);
  console.log('Real local Whisper transcription, original draft return and cancellation passed.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
