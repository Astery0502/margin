import { chromium } from '@playwright/test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Chromium can find a user's registered host even in a fresh browser profile.
export async function copyTestExtension(directory) {
  await cp('dist', directory, { recursive: true });
  for (const file of ['background.js', 'providers/native.js']) {
    const path = join(directory, file);
    const source = await readFile(path, 'utf8');
    const isolated = source.replaceAll('dev.margin.connect', 'dev.margin.test_connect');
    if (isolated === source) throw new Error('Missing native host binding in ' + file);
    await writeFile(path, isolated);
  }
}

export function launchTestExtension(extension, { profile = '', args = [], ...options } = {}) {
  return chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.BROWSER_BIN || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension, ...args],
    ...options,
  });
}
