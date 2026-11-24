import { readdirSync } from 'node:fs';

const katexDirectory = new URL('./', import.meta.resolve('katex'));

export const messageAssets = new Map([
  ['marked.umd.js', new URL('./marked.umd.js', import.meta.resolve('marked'))],
  ['purify.min.js', new URL('./purify.min.js', import.meta.resolve('dompurify'))],
  ['katex.min.js', new URL('./katex.min.js', katexDirectory)],
  ['markdown-math.js', new URL('./markdown-math.cjs', import.meta.url)],
  ['messages.js', new URL('./web/messages.js', import.meta.url)],
]);

export const interactionAssets = new Map([
  ['extension-ui.js', new URL('./web/extension-ui.js', import.meta.url)],
]);

export const mathAssets = new Map([
  ['katex.min.css', new URL('./katex.min.css', katexDirectory)],
  ...readdirSync(new URL('./fonts/', katexDirectory)).map(name => [`fonts/${name}`, new URL(`./fonts/${name}`, katexDirectory)]),
]);
