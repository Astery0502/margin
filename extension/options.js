import preferences from '../shared/model-preferences.cjs';
import { bundledModels } from './providers/openai.js';
import { profiles, saveProfiles } from './agents/settings.js';

const $ = id => document.getElementById(id);
const [config, catalog] = await Promise.all([profiles(), bundledModels()]);
const bundled = [...catalog.values()];
let available = bundled;
const picker = new MarginModelPicker($('model-picker'), 'Preferred model', id => {
  picker.select(id);
  showThinking($('thinking').value);
});
function showModels(id) {
  const model = catalog.get(id);
  picker.setOptions(available);
  picker.select(id, (model?.name || id) + ' (unavailable)');
}
function showThinking(selected) {
  const levels = catalog.get(picker.value)?.thinkingLevels || [selected || 'off'];
  $('thinking-field').hidden = levels.length < 2;
  $('thinking').replaceChildren(...levels.map(level => new Option(preferences.label(level), level)));
  if (levels.includes(selected)) $('thinking').value = selected;
}
function show(id) {
  const agent = config.items.find(item => item.id === id);
  $('profile').replaceChildren(...config.items.map(item => new Option(item.name, item.id)));
  $('profile').value = agent.id;
  $('profile-field').hidden = config.items.length < 2;
  $('name').value = agent.name;
  $('instructions').value = agent.instructions;
  showModels(agent.modelId);
  showThinking(agent.thinking);
  $('tier').checked = agent.tier === 'fast';
  for (const tool of ['ask', 'notes', 'delegate']) $(tool).checked = agent.tools.includes(tool);
}
show(config.selected);
$('profile').onchange = () => show($('profile').value);
let catalogRevision = 0;
async function refreshCatalog() {
  const revision = ++catalogRevision;
  try {
    const result = await PiBrowser.request('models');
    if (revision !== catalogRevision) return;
    available = result.connected ? result.models : bundled;
    showModels(picker.value);
  } catch { /* Offline preferences remain editable. */ }
}
PiBrowser.subscribe(event => {
  if (event.type === 'account-changed' || (event.type === 'connection' && !event.error)) refreshCatalog();
});
window.addEventListener('pageshow', event => { if (event.persisted) refreshCatalog(); });
refreshCatalog();
$('new-agent').onclick = () => {
  const template = config.items.find(item => item.id === $('profile').value);
  const id = crypto.randomUUID();
  config.items.push({ ...template, id, name: 'New agent' });
  show(id);
  $('name').select();
};
$('agent-form').onsubmit = async event => {
  event.preventDefault();
  const agent = config.items.find(item => item.id === $('profile').value);
  Object.assign(agent, { name: $('name').value.trim(), instructions: $('instructions').value, modelId: picker.value,
    thinking: $('thinking').value, tier: $('tier').checked ? 'fast' : 'default', tools: ['ask', 'notes', 'delegate'].filter(tool => $(tool).checked) });
  config.selected = agent.id;
  try { await saveProfiles(config); show(agent.id); $('status').textContent = 'Agent settings saved.'; }
  catch (error) { $('status').textContent = error.message; }
};
$('file-access').textContent = await chrome.extension.isAllowedFileSchemeAccess() ? 'Local file access is enabled.' : 'Enable Allow access to file URLs in the extension details, then reload your local tab.';
$('details').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
