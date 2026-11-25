import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import { account, cachedAccount } from './grant.js';

let catalog;

export function bundledModels() {
  catalog ??= fetch(chrome.runtime.getURL('providers/catalog.json')).then(r => r.json())
    .then(items => new Map(items.map(model => [model.id, {
      ...model, thinkingLevels: getSupportedThinkingLevels(model), speedTiers: ['default', 'fast'],
    }]))).catch(error => { catalog = undefined; throw error; });
  return catalog;
}

export async function modelCatalog(mode) {
  const preview = mode === 'preview';
  const connection = preview ? await cachedAccount() : await account(mode === 'refresh');
  if (!connection) return { connected: preview ? null : false, models: [] };
  const byId = await bundledModels();
  const models = connection.modelIds.map(id => byId.get(id)).filter(Boolean).map(model => ({
    ...model, name: connection.names?.[model.id] || model.name,
  }));
  return { connected: true, models };
}
