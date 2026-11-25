import { nativeHost, nativeCommand } from './providers/native.js';
import { directories, accountGeneration } from './providers/grant.js';
import { voice, discardVoice, transferVoice, microphoneTabClosed } from './dictation/background.js';
import { configurePdfRetention, pdfSourceAction } from './pdf/background.js';
import { sourceUrl, documentUrlForReader } from './pdf/urls.js';
import * as store from './discussions/store.js';
import { activateTab } from './tabs.js';
import { hasTaskHost, taskCommand } from './agents/runtime.js';
import { executionSettings, modelOptions } from './agents/settings.js';
import { sourceLifecycle } from './lifecycle.js';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const ports = new Set();
// Native side panels may have no Chrome documentId. The isolated client supplies a per-view ID.
const viewOwner = (sender, viewId) => sender.documentId || (isPanel(sender) && /^[a-f0-9]{32}$/.test(viewId) ? 'panel/' + viewId : null);
const isPanel = sender => sender.url === chrome.runtime.getURL('sidepanel.html');
const senderSource = sender => documentUrlForReader(sender.url) || sourceUrl(sender.url);

let nextCapture = 0;
let captureQueue = Promise.resolve();
function notify(event) {
  for (const port of ports) {
    if (event.owner && event.owner !== viewOwner(port.sender, port.name.slice(11))) continue;
    if (event.type !== 'account-changed' && !isPanel(port.sender) && senderSource(port.sender) !== event.sourceId) continue;
    try { port.postMessage(event); }
    catch (error) {
      // One failed delivery must not prevent the remaining views from receiving the event.
      ports.delete(port);
      port.disconnect();
      console.warn('Margin view notification failed:', event.type, error.message);
    }
  }
}

async function recoverTasks() {
  for (const sourceId of await store.recoverInterrupted()) notify({ type: 'sessions', sourceId });
}
const resumed = hasTaskHost().then(exists => exists || recoverTasks());

const retention = sourceLifecycle({
  listDocuments: store.sourceIds,
  removeDocument: async sourceId => {
    await taskCommand({ action: 'closeSource', sourceId }, { start: false });
    await discardVoice(sourceId);
    const result = await store.remove({ sourceId, wholePage: true, closing: true });
    await forget(result.groups.get(sourceId) || [], sourceId);
    notify({ type: 'source-closed', sourceId });
  },
});
configurePdfRetention(retention);
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

function capture(tab) {
  const result = captureQueue.then(async () => {
    const delay = nextCapture - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id) throw new Error('Return to the source tab to capture an image.');
    nextCapture = performance.now() + 1000 / chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND;
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  });
  captureQueue = result.catch(() => {});
  return result;
}

async function forget(ids, sourceId) {
  if (!ids.length) return;
  const selection = await chrome.storage.session.get(['activeId', 'relatedId', 'panelInput']);
  const keys = ['activeId', 'relatedId'].filter(key => ids.includes(selection[key]));
  if (ids.includes(selection.panelInput?.sessionId)) keys.push('panelInput');
  await chrome.storage.session.remove(keys);
  notify({ type: 'removed', sessionIds: ids, sourceId });
}

async function locate(session) {
  if (session.source.location.kind === 'pdf') return pdfSourceAction('locate', session);
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(tab => sourceUrl(tab.url) === session.sourceId);
  if (!tab) throw new Error('Reopen the source tab before locating this passage.');
  await activateTab(tab);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'pi-source-content', action: 'locate', source: session.source });
  if (response.error) throw new Error(response.error);
}

async function handle(action, values, sender, owner) {
  if (action === 'panel') {
    const opening = chrome.sidePanel.open({ windowId: sender.tab.windowId });
    await opening;
    if (values.sessionId) {
      const session = await store.get(values.sessionId);
      if (session.sourceId !== senderSource(sender)) throw new Error('The source page has changed.');
      await chrome.storage.session.set({ activeId: session.id, relatedId: null, panelInput: { sessionId: session.id, input: values.input, fromOwner: owner } });
      notify({ type: 'panel-session', sessionId: session.id });
    }
    return;
  }
  await resumed;
  await storageReady;
  if (['browse', 'matchingDiscussionIds', 'snapshot', 'activate', 'panelInput', 'storage', 'archivePage', 'clearPageFiles', 'deleteDiscussions', 'deletePage', 'exportPage'].includes(action) && !isPanel(sender)) throw new Error('Open the side panel to browse discussions.');
  const sourceId = senderSource(sender);
  if (['list', 'prepareDiscussion'].includes(action) && (!sourceId || sourceId !== (values.sourceId || values.source?.id))) throw new Error('The source page has changed.');
  if (['storage', 'archivePage', 'clearPageFiles', 'exportPage', 'deletePage'].includes(action) && !sourceUrl(values.sourceId)) throw new Error('Choose a source page first.');
  if (action === 'detail') {
    const detail = await store.detail(values.sessionId, values.cursor);
    if (!isPanel(sender) && detail.sourceId !== sourceId) throw new Error('This discussion belongs to another source.');
    return detail;
  }
  const session = values.sessionId && !values.sessionId.startsWith('draft:') ? await store.get(values.sessionId) : null;
  if (session && !isPanel(sender) && sourceId !== session.sourceId) throw new Error('This discussion belongs to another source.');
  switch (action) {
    case 'modelPreview': return modelOptions('preview');
    case 'identifier': return crypto.randomUUID();
    case 'sourceView': return retention.register(sender.tab.id, sender.url);
    case 'list': return store.list(sourceId);
    case 'prepareDiscussion': return store.prepareDiscussion(values.source);
    case 'get': return session;
    case 'locate': return locate(session);
    case 'edit': {
      const result = await store.edit(session.id, { archived: values.archived });
      notify({ type: 'sessions', sourceId: result.sourceId, change: { sessionId: result.id, sourceId: result.sourceId } });
      return result;
    }
    case 'connectAccount': {
      const source = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      await chrome.tabs.create({ url: chrome.runtime.getURL('connect.html?choose#passage'), openerTabId: source?.id, windowId: source?.windowId });
      return;
    }
    case 'models': return modelOptions();
    case 'model': {
      const settings = await executionSettings(values.agentId ? values : { ...session, ...values });
      const result = await store.edit(session.id, settings);
      notify({ type: 'sessions', sourceId: session.sourceId });
      return result;
    }
    case 'capabilities': return { dictation: true };
    case 'dictationStatus': return { ready: true };
    case 'captureImage': return capture(sender.tab);
    case 'snapshot': return chrome.storage.session.get(['relatedId', 'activeId']);
    case 'relate':
      await chrome.storage.session.set({ relatedId: values.sessionId });
      notify({ type: 'related', sessionId: values.sessionId });
      return;
    case 'activate': return chrome.storage.session.set({ activeId: values.sessionId, relatedId: null });
    case 'panelInput':
      return navigator.locks.request('panel-input', async () => {
        const { panelInput } = await chrome.storage.session.get('panelInput');
        if (panelInput?.sessionId !== values.sessionId) return null;
        await transferVoice(session.id, session.sourceId, panelInput.fromOwner, owner);
        await chrome.storage.session.remove('panelInput');
        return panelInput.input;
      });
    case 'inputDiscard': return discardVoice(sourceId, [values.sessionId]);
    case 'settings': return chrome.runtime.openOptionsPage();
    case 'browse': return store.browse(values);
    case 'matchingDiscussionIds': return store.matchingDiscussionIds(values);
    case 'storage': return store.storage(values.sourceId);
    case 'exportPage': return store.exportPage(values.sourceId);
    case 'clearPageFiles': return store.clearFiles(values.sourceId);
    case 'archivePage':
      await store.archivePage(values.sourceId, values.archived);
      notify({ type: 'sessions', sourceId: values.sourceId });
      return;
    case 'deletePage':
    case 'deleteDiscussions': {
      const result = await store.remove({ ...values, wholePage: action === 'deletePage', closing: false });
      for (const [sourceId, ids] of result.groups) {
        await discardVoice(sourceId, ids);
        await forget(ids, sourceId);
      }
      return { count: result.count };
    }
    case 'create':
      return retention.perform(sourceId, async () => {
        const settings = await executionSettings(values);
        const tab = await chrome.tabs.get(sender.tab.id);
        if (!sourceId || values.source?.id !== sourceId || sourceUrl(values.source.url) !== sourceId || sourceId !== senderSource({ url: tab.url }) || !retention.owns(tab.id, sourceId)) throw new Error('Open the source page to start a discussion.');
        return store.createDiscussion({ ...values, settings });
      });
    case 'send': {
      const generation = await accountGeneration(session.model.id, session.model.provider);
      return retention.perform(session.sourceId, () => taskCommand({ action, sessionId: session.id, values: { ...values, generation, authorizedModel: session.model.id } }));
    }
    case 'stop':
    case 'interaction':
      return retention.perform(session.sourceId, () => taskCommand({ action, sessionId: session.id, values }));
    case 'fork': {
      const branch = await retention.perform(session.sourceId, () => store.fork(session.id));
      notify({ type: 'sessions', sourceId: session.sourceId });
      return branch;
    }
    default: throw new Error('This operation is unavailable.');
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'margin-response' && port.sender.url === chrome.runtime.getURL('agents/host.html')) {
    const native = chrome.runtime.connectNative(nativeHost);
    port.onMessage.addListener(request => {
      if (!['response', 'deepseek-response'].includes(request.op)) { port.disconnect(); native.disconnect(); return; }
      try { native.postMessage(nativeCommand(request.op, request)); } catch (error) { port.postMessage({ error: error.message }); native.disconnect(); }
    });
    native.onMessage.addListener(frame => port.postMessage(frame));
    port.onDisconnect.addListener(() => native.disconnect());
    native.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (error) { try { port.postMessage({ error }); } catch {} }
      port.disconnect();
    });
    return;
  }
  if (!/^pi-sources\/[0-9a-f]{32}$/.test(port.name)) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const fromConnectionPage = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('connect.html');
  if (message.type === 'margin-stop-account-tasks' && fromConnectionPage) {
    taskCommand({ action: 'stopProvider', provider: message.provider === 'deepseek' ? 'deepseek' : 'openai' }, { start: false }).then(() => respond({}), error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'margin-account-changed' && fromConnectionPage) {
    const directory = directories[message.provider === 'deepseek' ? 'deepseek' : 'openai'];
    directory.invalidateAccount().then(() => {
      // Start warming the directory before the connect tab returns to the reader.
      directory.account().catch(console.error);
      notify({ type: 'account-changed' });
      respond({});
    }, error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'pi-dictation') {
    const dispatch = async () => {
      const { sessionId, action } = message;
      const sourceId = isPanel(sender) && sessionId ? (await store.get(sessionId)).sourceId : senderSource(sender);
      return voice(action, sessionId, sourceId, sender, message.recordingId, notify, viewOwner(sender, message.viewId));
    };
    dispatch().then(result => respond({ result }), error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'voice-event' && sender.url === chrome.runtime.getURL('agents/host.html')) {
    notify(message.event);
    respond({});
    return;
  }
  if (message.type === 'task-host-failed' && sender.url === chrome.runtime.getURL('agents/host.html')) {
    recoverTasks().then(() => respond({}), error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'task-event' && sender.url === chrome.runtime.getURL('agents/host.html')) {
    notify(message.event);
    respond({});
    return;
  }
  if (message.type !== 'pi-sources') return;
  handle(message.action, message.values || {}, sender, viewOwner(sender, message.viewId)).then(result => respond({ result }), error => respond({ error: error.message, code: error.code }));
  return true;
});

chrome.tabs.onRemoved.addListener(id => microphoneTabClosed(id, notify).catch(console.error));
