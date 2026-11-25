import { copySpeechModel } from './speech-model.js';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { messageAssets, interactionAssets, mathAssets } from '../shared/message-assets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'));
const pdfjs = fileURLToPath(new URL('.', import.meta.resolve('pdfjs-dist/package.json')));

async function assemble(destination, downloads) {
  await cp(resolve(root, 'extension'), destination, { recursive: true });
  const pdf = resolve(destination, 'pdf/pdfjs');
  await mkdir(pdf, { recursive: true });
  for (const [source, name] of [
    ['build/pdf.mjs', 'pdf.mjs'], ['build/pdf.worker.mjs', 'pdf.worker.mjs'],
    ['web/pdf_viewer.mjs', 'pdf_viewer.mjs'], ['web/pdf_viewer.css', 'pdf_viewer.css'],
    ['web/images', 'images'], ...['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(dir => [dir, dir]),
  ]) await cp(resolve(pdfjs, source), resolve(pdf, name), { recursive: true });
  await cp(resolve(pdfjs, 'LICENSE'), resolve(destination, 'LICENSE.pdfjs-dist'));
  const scripts = [...messageAssets, ...interactionAssets];
  await mkdir(resolve(destination, 'shared/fonts'), { recursive: true });
  await Promise.all([...scripts, ...mathAssets].map(([name, file]) => cp(file, resolve(destination, 'shared', name))));
  for (const name of ['marked', 'dompurify', 'katex']) {
    await cp(new URL('../LICENSE', import.meta.resolve(name)), resolve(destination, 'LICENSE.' + name));
  }
  const manifestPath = resolve(destination, 'manifest.json');
  manifest.content_scripts[0].js.unshift(...scripts.map(([name]) => 'shared/' + name));
  manifest.web_accessible_resources = [{ resources: ['shared/katex.min.css', 'shared/fonts/*', 'pdf/reader.html'], matches: manifest.content_scripts[0].matches }];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  await build({
    entryPoints: ['background.js', 'options.js'].map(name => resolve(root, 'extension', name)), outdir: destination,
    bundle: true, format: 'esm', platform: 'browser', target: 'chrome130',
  });

  const catalogBase = import.meta.resolve('@earendil-works/pi-ai/models');
  const { OPENAI_MODELS } = await import(new URL('providers/openai.models.js', catalogBase));
  const { DEEPSEEK_MODELS } = await import(new URL('providers/deepseek.models.js', catalogBase));
  const models = [...Object.values(OPENAI_MODELS), ...Object.values(DEEPSEEK_MODELS)];
  await writeFile(resolve(destination, 'providers/catalog.json'), JSON.stringify(models));
  await build({
    entryPoints: [resolve(root, 'extension/agents/worker.js')], outfile: resolve(destination, 'agents/worker.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'chrome130',
  });

  const speechLibrary = resolve(root, 'node_modules/@huggingface/transformers');
  const speechAssets = resolve(destination, 'dictation/lib');
  await mkdir(speechAssets, { recursive: true });
  for (const asset of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    await cp(resolve(speechLibrary, 'dist', asset), resolve(speechAssets, asset));
  }
  await cp(resolve(speechLibrary, 'LICENSE'), resolve(destination, 'LICENSE.transformers'));
  await copySpeechModel(root, destination);
  await cp(resolve(root, 'third-party'), resolve(destination, 'licenses'), { recursive: true });
  for (const [name, license] of [['idb', 'LICENSE'], ['openai', 'LICENSE'], ['partial-json', 'LICENSE']]) {
    await cp(resolve(root, 'node_modules', name, license), resolve(destination, 'licenses', 'LICENSE.' + name));
  }

  await cp(resolve(root, 'node_modules/@earendil-works/pi-schema/THIRD_PARTY_NOTICES'), resolve(destination, 'licenses/pi-schema'), { recursive: true });
  await writeFile(resolve(destination, 'providers/download.json'), JSON.stringify(downloads));
}

if (process.argv[2] === '--store') {
  const tag = process.argv[3];
  const version = manifest.version;
  if (tag !== 'v' + version || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/.test(version)
      || version === '0.0.0' || version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('Use a stable vMAJOR.MINOR.PATCH tag matching the extension manifest.');
  }
  delete manifest.key; // The store assigns its own signing key and extension ID.
  const base = 'https://github.com/Astery0502/margin/releases/download/' + tag + '/';
  const output = resolve(root, 'dist-native');
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(resolve(output, 'store-'));
  try {
    const extension = resolve(work, 'extension');
    await assemble(extension, { mac: base + 'Margin-Connect-macOS.zip', win: base + 'Margin-Connect-Windows.exe' });
    const archive = 'Margin-Web-Store.zip';
    execFileSync('zip', ['-q', '-X', '-r', resolve(work, archive), '.'], { cwd: extension });
    await rename(resolve(work, archive), resolve(output, archive));
    console.log('Built ' + archive + ' for ' + tag);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
} else {
  const downloads = {};
  for (const [os, address] of Object.entries({
    mac: process.env.MARGIN_CONNECT_MAC_URL || process.env.MARGIN_CONNECT_DOWNLOAD_URL,
    win: process.env.MARGIN_CONNECT_WINDOWS_URL,
  })) {
    if (!address) continue;
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS Margin Connect download URL.');
    downloads[os] = url.href;
  }
  const destination = resolve(root, 'dist');
  await rm(destination, { recursive: true, force: true });
  await assemble(destination, downloads);
}
