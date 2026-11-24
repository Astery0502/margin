import { modelCatalog } from '../providers/openai.js';

const initial = {
  id: 'reader', name: 'Reader', instructions: 'Discuss the selected passage in the context of the reader’s question.',
  modelId: 'gpt-6.1-sol', thinking: 'high', tier: 'fast', tools: ['ask'],
};

export async function profiles() {
  const { agentProfiles } = await chrome.storage.local.get('agentProfiles');
  return agentProfiles || { selected: initial.id, items: [initial] };
}

export async function saveProfiles({ items, selected }) {
  if (!Array.isArray(items) || !items.length || !items.some(item => item.id === selected)) throw new Error('Choose a default agent.');
  const ids = new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id) || !item.name?.trim()) throw new Error('Each agent needs a distinct ID and a name.');
    ids.add(item.id);
    if (!Array.isArray(item.tools) || item.tools.some(tool => !['notes', 'ask', 'delegate'].includes(tool))) throw new Error('Unknown agent tool.');
  }
  await chrome.storage.local.set({ agentProfiles: { selected, items } });
}

export async function modelOptions(agentId, changes = {}) {
  const [{ items, selected }, { connected, models: catalog }] = await Promise.all([profiles(), modelCatalog()]);
  const agent = items.find(item => item.id === (agentId || selected));
  if (!agent) throw new Error('Choose an available agent.');
  const requested = changes.model?.id || agent.modelId;
  const model = catalog.find(model => model.id === requested) || catalog[0];
  const thinking = changes.thinking || agent.thinking;
  const tier = changes.tier || agent.tier;
  return { connected, models: catalog, agents: items.map(({ id, name }) => ({ id, name })), defaults: {
    agentId: agent.id, model, thinking: model?.thinkingLevels.includes(thinking) ? thinking : model?.thinkingLevels[0],
    tier: model?.speedTiers.includes(tier) ? tier : 'default',
  } };
}

export async function executionSettings(changes) {
  const { defaults } = await modelOptions(changes.agentId, changes);
  if (!defaults.model) throw new Error('A connected OpenAI subscription is required to send a question.');
  const { items } = await profiles();
  const agent = items.find(item => item.id === defaults.agentId);
  return { ...defaults, instructions: agent.instructions, tools: agent.tools };
}
