import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import lock from '../../extension/dictation/model.json' with { type: 'json' };

const run = promisify(execFile);
async function digest(file) {
  try { return 'sha256-' + createHash('sha256').update(await readFile(file)).digest('base64'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function prepareSpeechFixture() {
  for (const [file, expected] of Object.entries(lock.files)) {
    const cache = resolve('.cache/whisper-tiny', file);
    if (await digest(cache) !== expected) {
      await mkdir(dirname(cache), { recursive: true });
      const temporary = cache + '.' + randomUUID();
      try {
        const url = 'https://huggingface.co/' + lock.repository + '/resolve/' + lock.revision + '/' + file;
        await run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '180', '--output', temporary, url]);
        if (await digest(temporary) !== expected) throw new Error('Speech model checksum mismatch for ' + file);
        await rename(temporary, cache);
      } finally { await rm(temporary, { force: true }); }
    }
  }
  return resolve('.cache/whisper-tiny');
}
