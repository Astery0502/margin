import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import { directories } from './grant.js';

let catalog;

export function bundledModels() {
  catalog ??= fetch(chrome.runtime.getURL('providers/catalog.json')).then(r => r.json())
    .then(items => new Map(items.map(model => [model.id, {
      ...model, thinkingLevels: getSupportedThinkingLevels(model), speedTiers: model.provider === 'openai' ? ['default', 'fast'] : [],
    }]))).catch(error => { catalog = undefined; throw error; });
  return catalog;
}

export async function modelCatalog(mode) {
  const preview = mode === 'preview';
  const listings = await Promise.allSettled(Object.values(directories).map(directory =>
    preview ? directory.cachedAccount() : directory.account(mode === 'refresh')));
  const byId = await bundledModels();
  const models = [];
  let connected = false;
  for (const [index, provider] of Object.keys(directories).entries()) {
    const result = listings[index];
    if (!result.value) continue;
    connected = true;
    for (const id of result.value.modelIds) {
      const model = byId.get(id);
      if (model?.provider === provider) models.push({ ...model, name: result.value.names?.[id] || model.name });
    }
  }
  const failed = listings.find(result => result.status === 'rejected');
  if (!connected && failed) throw failed.reason;
  return { connected: connected || (preview ? null : false), models };
}
