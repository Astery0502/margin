import preferences from '../../shared/model-preferences.cjs';
import { bundledModels, modelCatalog } from '../providers/openai.js';
import { unavailableModel } from '../providers/grant.js';

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

export async function modelOptions(mode = 'refresh') {
  const [{ items, selected }, { connected, models }, bundled] = await Promise.all([profiles(), modelCatalog(mode), bundledModels()]);
  const agents = items.map(agent => {
    const model = connected === null ? bundled.get(agent.modelId) : models.find(item => item.id === agent.modelId) || models[0];
    return { id: agent.id, name: agent.name, defaults: settingsFor(agent, model) };
  });
  return { connected, models, agents, defaults: agents.find(agent => agent.id === selected)?.defaults };
}

function settingsFor(agent, model, changes = {}) {
  return preferences.normalize({ agentId: agent.id, model, thinking: changes.thinking || agent.thinking, tier: changes.tier || agent.tier });
}

export async function executionSettings(changes) {
  const [{ items, selected }, { connected, models }] = await Promise.all([profiles(), modelCatalog()]);
  if (!connected) throw new Error('A connected OpenAI subscription is required to send a question.');
  const agent = items.find(item => item.id === (changes.agentId || selected));
  if (!agent) throw new Error('Choose an available agent.');
  const id = changes.model?.id || agent.modelId;
  const model = models.find(item => item.id === id) || (!changes.model && models[0]);
  if (!model) throw unavailableModel(id);
  return { ...settingsFor(agent, model, changes), instructions: agent.instructions, tools: agent.tools };
}
