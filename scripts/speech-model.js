import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import lock from './speech-model.json' with { type: 'json' };

const run = promisify(execFile);
async function digest(file) {
  try { return createHash('sha256').update(await readFile(file)).digest('hex'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function copySpeechModel(root, destination) {
  for (const [file, expected] of Object.entries(lock.files)) {
    const cache = resolve(root, '.cache/whisper-tiny', file);
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
    const output = resolve(destination, 'dictation/models', lock.repository, file);
    await mkdir(dirname(output), { recursive: true });
    await cp(cache, output);
  }
}
