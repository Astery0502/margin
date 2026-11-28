import { tabSource } from './pdf/urls.js';
import * as store from './discussions/store.js';

export function sourceLifecycle(removeDocument) {
  const documentActions = new Map();

  function perform(sourceId, action) {
    const operation = (documentActions.get(sourceId) || Promise.resolve()).then(action);
    const settled = operation.catch(() => {});
    documentActions.set(sourceId, settled);
    settled.then(() => { if (documentActions.get(sourceId) === settled) documentActions.delete(sourceId); });
    return operation;
  }

  async function reassign({ sourceId, tabId }, candidates) {
    if ((await store.documentOwner(sourceId))?.tabId !== tabId) return;
    for (const id of candidates) {
      // Commit first so a concurrent close can find the new owner.
      if (!await store.transferDocument(sourceId, tabId, id)) return;
      if (await chrome.tabs.get(id).catch(() => null)) return;
      tabId = id;
    }
    await removeDocument(sourceId);
  }

  async function checkOwners(owners) {
    if (!owners.length) return;
    // Reserve the affected queues before taking a shared snapshot of the tabs.
    const snapshot = Promise.all(owners.map(({ sourceId }) => documentActions.get(sourceId))).then(async () => {
      const tabs = await chrome.tabs.query({});
      return { open: new Set(tabs.map(tab => tab.id)), bySource: Map.groupBy(tabs, tabSource) };
    });
    await Promise.all(owners.map(owner => perform(owner.sourceId, async () => {
      const { open, bySource } = await snapshot;
      if (!open.has(owner.tabId)) await reassign(owner, (bySource.get(owner.sourceId) || []).map(tab => tab.id));
    })));
  }

  async function closed(tabId) {
    await checkOwners(await store.documentOwners(tabId));
  }
  chrome.tabs.onRemoved.addListener(id => closed(id).catch(console.error));

  // A worker can restart after the owner closed or during a handoff.
  async function recover() {
    const owners = await store.documentOwners();
    if (!owners.length) return;
    const open = new Set((await chrome.tabs.query({})).map(tab => tab.id));
    await checkOwners(owners.filter(owner => !open.has(owner.tabId)));
  }
  recover().catch(console.error);
  return { perform, closed };
}
