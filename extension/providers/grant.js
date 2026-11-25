import { nativeRequest, hostMissing, outdatedHost } from './native.js';

const listingLifetime = 5 * 60 * 1000;
function directory(name, prefix, storageKey) {
  let revision = 0, verified, pending;

  // This snapshot can populate a picker while the native account is being checked.
  // Only a verified listing can authorize a send.
  async function cachedAccount() {
    return (await chrome.storage.local.get(storageKey))[storageKey];
  }

  function invalidateAccount() {
    revision++;
    verified = pending = undefined;
    return chrome.storage.local.remove(storageKey);
  }

  function sameLogin(snapshot, status) {
    return snapshot && status.connected && snapshot.accountId === status.selected && snapshot.generation === status.generation;
  }

  async function refresh(version) {
    function checkRevision() {
      if (version !== revision) throw new Error(`The ${name} account changed. Try again.`);
    }
    const [status, snapshot] = await Promise.all([
      nativeRequest(prefix + 'status').catch(error => {
        if (outdatedHost(error) || hostMissing(error)) return { connected: false };
        throw error;
      }),
      cachedAccount(),
    ]);
    checkRevision();
    if (sameLogin(snapshot, status) && snapshot.expires > Date.now()) return snapshot;
    verified = undefined;
    if (snapshot && !sameLogin(snapshot, status)) await chrome.storage.local.remove(storageKey);
    if (!status.connected) return null;
    const result = await nativeRequest(prefix + 'models');
    checkRevision();
    if (!result.connected) { await chrome.storage.local.remove(storageKey); return null; }
    const listing = { accountId: status.selected, generation: status.generation, expires: Date.now() + listingLifetime,
      modelIds: result.modelIds, names: result.names || {} };
    // Another browser may have switched the native account during the network request.
    const current = await nativeRequest(prefix + 'status');
    checkRevision();
    if (!sameLogin(listing, current)) throw new Error(`The ${name} account changed. Try again.`);
    await chrome.storage.local.set({ [storageKey]: listing });
    return listing;
  }

  function account(checkStatus = false) {
    if (!checkStatus && verified?.expires > Date.now()) return Promise.resolve(verified);
    if (pending) return pending;
    const version = revision;
    const request = refresh(version).then(listing => {
      if (version !== revision) throw new Error(`The ${name} account changed. Try again.`);
      verified = listing;
      return listing;
    }).finally(() => { if (pending === request) pending = undefined; });
    pending = request;
    return request;
  }

  return { cachedAccount, invalidateAccount, account };
}

export const directories = {
  openai: directory('ChatGPT', '', 'modelListing'),
  deepseek: directory('DeepSeek', 'deepseek-', 'deepseekListing'),
};

export function unavailableModel(id) {
  return Object.assign(new Error(`${id} is no longer available. Choose another model before sending.`), { code: 'MODEL_UNAVAILABLE' });
}

export async function accountGeneration(modelId, provider = 'openai') {
  const listing = await directories[provider].account();
  if (!listing) throw new Error(`Reconnect your ${provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT'} account before sending.`);
  if (!listing.modelIds.includes(modelId)) throw unavailableModel(modelId);
  return listing.generation;
}
