import { copyTestExtension, launchTestExtension } from './fixtures/native-extension.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';

const temp = await mkdtemp(join(tmpdir(), 'margin-speech-'));
const audio = join(temp, 'speech.wav');
const extension = join(temp, 'extension');
const model = join(extension, 'dictation/models/Xenova/whisper-tiny/onnx/encoder_model_quantized.onnx');
const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Reading</title><p>Discuss this passage in your own words.</p>'));
try {
  await copyTestExtension(extension);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await checkDictation({ voice: 'Tingting', speech: '今天天气很好，我们一起去公园散步。', expected: /今天|天[气氣]|公[园園]|散步/ });
  await checkDictation({ voice: 'Samantha', speech: 'This is a reading test. The book is on the table.', expected: /reading|book|table/i });
  await checkDictation({ voice: 'Tingting', speech: '今天天气很好。[[slnc 600]] The book is on the table.',
    expected: /(?:今天|天[气氣]).*(?:book|table)/is, duration: 6500, checkLifecycle: true });
  await checkDictation({ voice: 'Samantha', speech: 'The book is on the table.', expected: /book.*table/i, language: 'en' });
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

async function checkDictation({ voice, speech, expected, duration = 4600, language, checkLifecycle = false }) {
  let browser;
  try {
    execFileSync('say', ['-v', voice, '-o', join(temp, 'speech.aiff'), speech]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', join(temp, 'speech.aiff'), audio]);
    if (checkLifecycle) await rename(model, model + '.unavailable');
    browser = await launchTestExtension(extension, {
      args: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + audio],
    });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
    const settings = await browser.newPage();
    await settings.goto(new URL('options.html', worker.url()).href);
    const spokenLanguage = settings.getByLabel('Spoken language');
    await expect(spokenLanguage).toBeEnabled();
    await expect(spokenLanguage).toHaveValue('auto');
    if (language) {
      await spokenLanguage.selectOption(language);
      await expect(settings.getByText('Dictation language saved.')).toBeVisible();
      await settings.reload();
      await expect(spokenLanguage).toHaveValue(language);
    }
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
    if (checkLifecycle) {
      await checkMicrophonePermission(browser, page, record);
    } else {
      await browser.grantPermissions(['microphone']);
      await record.click();
    }
    await page.bringToFront();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
    if (checkLifecycle) {
      await page.getByRole('button', { name: 'Resize discussion' }).press('ArrowUp');
      const waveform = await page.getByRole('img', { name: 'Microphone activity' }).boundingBox();
      const status = await page.getByText(/^Recording \d+:\d+$/).boundingBox();
      assert.ok(waveform.width > 0 && status.width > 0);
      assert.ok(status.x + status.width <= waveform.x || waveform.y + waveform.height <= status.y,
        'The recording status must have its own space beside or below the waveform.');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Return to recording draft' }).click();
    }
    await page.waitForTimeout(duration);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    if (checkLifecycle) {
      await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: 20000 });
      await page.getByRole('button', { name: 'Listen', exact: true }).click();
      await expect(page.locator('#voice-audio')).toHaveAttribute('src', /^data:audio/);
      await rename(model + '.unavailable', model);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    await expect(draft).toHaveValue(expected, { timeout: 90000 });
    const transcript = await draft.inputValue();
    if (checkLifecycle) {
      await record.click();
      await page.getByRole('button', { name: 'Cancel dictation' }).click();
      await expect(draft).toHaveValue(transcript);
    }
    assert.match(transcript, /^Notes:/);
    console.log('Local dictation passed:', transcript);
  } finally {
    await browser?.close();
  }
}

async function checkMicrophonePermission(browser, page, record) {
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
}
