import { copySpeechModel } from './speech-model.js';
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { messageAssets, interactionAssets, mathAssets } from '../shared/message-assets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'dist');
const pdfjs = fileURLToPath(new URL('.', import.meta.resolve('pdfjs-dist/package.json')));
await rm(destination, { recursive: true, force: true });
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
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.content_scripts[0].js.unshift(...scripts.map(([name]) => 'shared/' + name));
manifest.web_accessible_resources = [{ resources: ['shared/katex.min.css', 'shared/fonts/*', 'pdf/reader.html'], matches: manifest.content_scripts[0].matches }];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

await build({
  entryPoints: ['background.js', 'options.js'].map(name => resolve(root, 'extension', name)), outdir: destination,
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome130',
});

const catalogModule = new URL('providers/openai.models.js', import.meta.resolve('@earendil-works/pi-ai/models'));
const { OPENAI_MODELS } = await import(catalogModule.href);
await writeFile(resolve(destination, 'providers/catalog.json'), JSON.stringify(Object.values(OPENAI_MODELS)));
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
for (const [name, license] of [['idb', 'LICENSE'], ['openai', 'LICENSE'], ['typebox', 'license'], ['partial-json', 'LICENSE']]) {
  await cp(resolve(root, 'node_modules', name, license), resolve(destination, 'licenses', 'LICENSE.' + name));
}

const download = process.env.MARGIN_CONNECT_DOWNLOAD_URL;
if (download) {
  const url = new URL(download);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS Margin Connect download URL.');
  await writeFile(resolve(destination, 'providers/download.json'), JSON.stringify({ url: url.href }));
}
