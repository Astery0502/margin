import { profiles, saveProfiles } from './agents/settings.js';

const $ = id => document.getElementById(id);
const config = await profiles();
const catalog = await (await fetch('./providers/catalog.json')).json();
$('model').replaceChildren(...catalog.map(model => new Option(model.name, model.id)));
function showThinking(selected) {
  const model = catalog.find(item => item.id === $('model').value);
  const levels = model?.thinkingLevelMap ? Object.keys(model.thinkingLevelMap).filter(key => model.thinkingLevelMap[key] !== null) : model?.reasoning ? ['low', 'medium', 'high'] : ['off'];
  $('thinking').replaceChildren(...levels.map(level => new Option(level, level)));
  if (levels.includes(selected)) $('thinking').value = selected;
}
function show(id) {
  const agent = config.items.find(item => item.id === id);
  $('profile').replaceChildren(...config.items.map(item => new Option(item.name, item.id)));
  $('profile').value = agent.id;
  $('name').value = agent.name;
  $('instructions').value = agent.instructions;
  $('model').value = agent.modelId;
  showThinking(agent.thinking);
  $('tier').value = agent.tier;
  for (const tool of ['ask', 'notes', 'delegate']) $(tool).checked = agent.tools.includes(tool);
}
show(config.selected);
$('profile').onchange = () => show($('profile').value);
$('model').onchange = () => showThinking($('thinking').value);
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
  Object.assign(agent, { name: $('name').value.trim(), instructions: $('instructions').value, modelId: $('model').value,
    thinking: $('thinking').value, tier: $('tier').value, tools: ['ask', 'notes', 'delegate'].filter(tool => $(tool).checked) });
  config.selected = agent.id;
  try { await saveProfiles(config); show(agent.id); $('status').textContent = 'Agent settings saved.'; }
  catch (error) { $('status').textContent = error.message; }
};
$('file-access').textContent = await chrome.extension.isAllowedFileSchemeAccess() ? 'Local file access is enabled.' : 'Enable Allow access to file URLs in the extension details, then reload your local tab.';
$('details').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
