import { documentUrlForReader } from './pdf/urls.js';
import { reconcilePdfCaches, clearPdfCache } from './pdf/lifecycle.js';

function sourceView(url) {
  const pdf = documentUrlForReader(url);
  if (pdf) return { sourceId: pdf, kind: 'pdf' };
  const parsed = new URL(url);
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  return { sourceId: parsed.href, kind: 'html' };
}

async function identifyHtml(tabId, view) {
  const identity = await chrome.tabs.sendMessage(tabId, { type: 'pi-source-content', action: 'identity' }).catch(() => null);
  return identity?.sourceId === view.sourceId ? view : null;
}

export function sourceLifecycle({ listDocuments, removeDocument }) {
  let views = {}, pending = new Set();
  let operations = Promise.resolve(), reconciliation, flushing;
  const documentActions = new Map();
  const ready = (async () => {
    const saved = await chrome.storage.local.get(['sourceViews', 'closedSourceDocuments', 'pdfReaders', 'closedPdfDocuments']);
    const tabs = await chrome.tabs.query({});
    const savedHtml = new Set(Object.values(saved.sourceViews || {}).filter(view => view.kind === 'html').map(view => view.sourceId));
    const entries = await Promise.all(tabs.filter(tab => tab.url).map(async tab => {
      const view = sourceView(tab.url);
      if (!view) return null;
      if (view.kind === 'pdf') return [tab.id, view];
      if (savedHtml.has(view.sourceId)) return [tab.id, view];
      return await identifyHtml(tab.id, view) ? [tab.id, view] : null;
    }));
    views = Object.fromEntries(entries.filter(Boolean));
    const open = new Set(Object.values(views).map(view => view.sourceId));
    const previous = [...Object.values(saved.sourceViews || {}).map(view => view.sourceId), ...Object.values(saved.pdfReaders || {})];
    pending = new Set([...(saved.closedSourceDocuments || []), ...(saved.closedPdfDocuments || []), ...previous.filter(url => !open.has(url))]);
    await reconcilePdfCaches(views, pending);
    await save();
    await chrome.storage.local.remove(['pdfReaders', 'closedPdfDocuments']);
  })();

  function save() { return chrome.storage.local.set({ sourceViews: views, closedSourceDocuments: [...pending] }); }
  function change(tabId, nextView) {
    const operation = operations.then(async () => {
      await ready;
      const view = await nextView;
      const previous = views[tabId];
      if (previous?.sourceId === view?.sourceId && previous?.kind === view?.kind) return false;
      if (view) views[tabId] = view;
      else delete views[tabId];
      if (previous) pending.add(previous.sourceId);
      await save();
      if (previous?.kind === 'pdf') await clearPdfCache(tabId);
      return true;
    });
    operations = operation.catch(console.error);
    operation.then(changed => changed && flush(), console.error).catch(console.error);
    return operation;
  }
  async function register(tabId, url) {
    const tab = await chrome.tabs.get(tabId);
    const view = sourceView(url), current = sourceView(tab.url);
    if (!view || view.sourceId !== current?.sourceId || view.kind !== current.kind) throw new Error('The source page has changed. Select the passage again.');
    return change(tabId, view);
  }
  chrome.tabs.onUpdated.addListener((id, changeInfo) => {
    if (!changeInfo.url) return;
    ready.then(() => {
      const view = sourceView(changeInfo.url);
      if (views[id] || view?.kind === 'pdf') return change(id, view?.kind === 'html' ? identifyHtml(id, view) : view).then(changed => {
        if (changed && view?.kind === 'html') return chrome.tabs.sendMessage(id, { type: 'pi-source-content', action: 'navigation' }).catch(() => {});
      });
    }).catch(console.error);
  });
  chrome.tabs.onRemoved.addListener(id => change(id, null));

  function reconcile() {
    return reconciliation ??= (async () => {
      await ready;
      const documents = await listDocuments();
      await operations;
      const open = new Set(Object.values(views).map(view => view.sourceId));
      for (const sourceId of documents) if (!open.has(sourceId)) pending.add(sourceId);
      await save();
    })().catch(error => { reconciliation = undefined; throw error; });
  }
  function enqueue(sourceId, action) {
    const operation = (documentActions.get(sourceId) || Promise.resolve()).then(action);
    const settled = operation.catch(() => {});
    documentActions.set(sourceId, settled);
    settled.then(() => { if (documentActions.get(sourceId) === settled) documentActions.delete(sourceId); });
    return operation;
  }
  function cleanup(sourceId) {
    return enqueue(sourceId, async () => {
      if (!pending.has(sourceId)) return;
      await removeDocument(sourceId);
      pending.delete(sourceId);
      await save();
    });
  }
  async function perform(sourceId, action) {
    await ready; await operations; await reconcile();
    if (pending.has(sourceId)) await cleanup(sourceId);
    return enqueue(sourceId, action);
  }
  function flush() {
    if (flushing) return flushing;
    const operation = (async () => {
      await ready; await operations; await reconcile();
      while (pending.size) await Promise.all([...pending].map(cleanup));
    })();
    flushing = operation;
    operation.finally(() => { flushing = null; }).catch(() => {});
    return operation;
  }
  ready.then(flush).catch(console.error);
  return { ready, flush, register, perform, owns: (tabId, sourceId) => views[tabId]?.sourceId === sourceId };
}
