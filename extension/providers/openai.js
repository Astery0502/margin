import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import { account } from './grant.js';

let catalog, pending;
export function invalidateModels() { pending = undefined; }

async function load() {
  const connection = await account();
  if (!connection) return { connected: false, models: [] };
  catalog ??= fetch(chrome.runtime.getURL('providers/catalog.json')).then(r => r.json())
    .then(items => new Map(items.map(item => [item.id, item]))).catch(error => { catalog = undefined; throw error; });
  const byId = await catalog;
  const models = connection.modelIds.map(id => byId.get(id)).filter(Boolean).map(model => ({
    ...model, name: connection.names?.[model.id] || model.name, thinkingLevels: getSupportedThinkingLevels(model), speedTiers: ['default', 'fast'],
  }));
  return { connected: true, models };
}
export function modelCatalog() {
  if (pending) return pending;
  const request = load().finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}
