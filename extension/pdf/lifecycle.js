import { pdfCacheUrl } from './urls.js';

export const pdfCacheName = tabId => `pi-pdf-reader-${tabId}`;
export const clearPdfCache = tabId => caches.delete(pdfCacheName(tabId));

export async function reconcilePdfCaches(views, pending) {
  const readers = Object.fromEntries(Object.entries(views).filter(([, view]) => view.kind === 'pdf').map(([id, view]) => [id, view.sourceId]));
  const keep = new Set(Object.keys(readers).map(pdfCacheName));
  for (const name of await caches.keys()) {
    if (!name.startsWith('pi-pdf-')) continue;
    const previous = await caches.open(name);
    for (const request of await previous.keys()) {
      for (const [id, url] of Object.entries(readers)) {
        if (request.url !== pdfCacheUrl(url) || pending.has(url) || name === pdfCacheName(id)) continue;
        const current = await caches.open(pdfCacheName(id));
        if (!await current.match(request)) await current.put(request, await previous.match(request));
      }
    }
    if (!keep.has(name)) await caches.delete(name);
    else {
      const url = readers[name.slice('pi-pdf-reader-'.length)];
      for (const request of await previous.keys()) if (request.url !== pdfCacheUrl(url) || pending.has(url)) await previous.delete(request);
    }
  }
}
