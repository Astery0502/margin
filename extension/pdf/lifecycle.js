import { documentUrlForReader, pdfCacheUrl } from './urls.js';

const pdfCacheName = tabId => `pi-pdf-reader-${tabId}`;
const readers = new Map();
let maintenance = initialize();

async function initialize() {
  for (const tab of await chrome.tabs.query({ url: chrome.runtime.getURL('pdf/reader.html') + '*' })) {
    const url = documentUrlForReader(tab.url);
    if (url) readers.set(tab.id, url);
  }
  const keep = new Set([...readers.keys()].map(pdfCacheName));
  for (const name of await caches.keys()) {
    if (!name.startsWith('pi-pdf-')) continue;
    const previous = await caches.open(name);
    for (const request of await previous.keys()) {
      for (const [id, url] of readers) {
        if (request.url !== pdfCacheUrl(url) || name === pdfCacheName(id)) continue;
        const current = await caches.open(pdfCacheName(id));
        if (!await current.match(request)) await current.put(request, await previous.match(request));
      }
    }
    if (!keep.has(name)) await caches.delete(name);
    else {
      const url = readers.get(Number(name.slice('pi-pdf-reader-'.length)));
      for (const request of await previous.keys()) if (request.url !== pdfCacheUrl(url)) await previous.delete(request);
    }
  }
}

function update(tabId, url) {
  maintenance = maintenance.then(async () => {
    const previous = readers.get(tabId) ?? null;
    if (previous === url) return;
    if (url) readers.set(tabId, url);
    else readers.delete(tabId);
    if (previous) await caches.delete(pdfCacheName(tabId));
  }).catch(console.error);
}

chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url) update(id, documentUrlForReader(change.url));
});
chrome.tabs.onRemoved.addListener(id => update(id, null));

export async function readerCache(tabId, url) {
  await maintenance;
  const current = await chrome.tabs.get(tabId);
  if (documentUrlForReader(current.url) !== documentUrlForReader(url)) throw new Error('The source page has changed.');
  return pdfCacheName(tabId);
}
