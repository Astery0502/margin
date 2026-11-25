import { nativeRequest, hostMissing } from './native.js';

const listingLifetime = 5 * 60 * 1000;
let revision = 0, verified, pending;

// This snapshot can populate a picker while the native account is being checked.
// Only a verified listing can authorize a send.
export async function cachedAccount() {
  const { modelListing } = await chrome.storage.local.get('modelListing');
  return modelListing;
}

export function invalidateAccount() {
  revision++;
  verified = pending = undefined;
  return chrome.storage.local.remove('modelListing');
}

function sameLogin(snapshot, status) {
  return snapshot && status.connected && snapshot.accountId === status.selected && snapshot.generation === status.generation;
}

async function refresh(version) {
  function checkRevision() {
    if (version !== revision) throw new Error('The ChatGPT account changed. Try again.');
  }
  const [status, snapshot] = await Promise.all([
    nativeRequest('status').catch(error => { if (hostMissing(error)) return { connected: false }; throw error; }),
    cachedAccount(),
  ]);
  checkRevision();
  if (sameLogin(snapshot, status) && snapshot.expires > Date.now()) return snapshot;
  verified = undefined;
  if (snapshot && !sameLogin(snapshot, status)) await chrome.storage.local.remove('modelListing');
  if (!status.connected) return null;
  const result = await nativeRequest('models');
  checkRevision();
  if (!result.connected) { await chrome.storage.local.remove('modelListing'); return null; }
  const listing = { accountId: status.selected, generation: status.generation, expires: Date.now() + listingLifetime,
    modelIds: result.modelIds, names: result.names || {} };
  // Another browser may have switched the native account during the network request.
  const current = await nativeRequest('status');
  checkRevision();
  if (!sameLogin(listing, current)) throw new Error('The ChatGPT account changed. Try again.');
  await chrome.storage.local.set({ modelListing: listing });
  return listing;
}

export function account(checkStatus = false) {
  if (!checkStatus && verified?.expires > Date.now()) return Promise.resolve(verified);
  if (pending) return pending;
  const version = revision;
  const request = refresh(version).then(listing => {
    if (version !== revision) throw new Error('The ChatGPT account changed. Try again.');
    verified = listing;
    return listing;
  }).finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}

export function unavailableModel(id) {
  return Object.assign(new Error(`${id} is no longer available. Choose another model before sending.`), { code: 'MODEL_UNAVAILABLE' });
}

export async function accountGeneration(modelId) {
  const listing = await account();
  if (!listing) throw new Error('Reconnect your ChatGPT account before sending.');
  if (!listing.modelIds.includes(modelId)) throw unavailableModel(modelId);
  return listing.generation;
}
