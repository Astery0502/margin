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
