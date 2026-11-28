import { tabSource } from './pdf/urls.js';
import { bindIconHints } from './sidepanel/icon-hints.js';
import { discussionDirectory } from './sidepanel/directory.js';

const $ = id => document.getElementById(id);
const context = { activeId: null, activeSourceId: null, relatedId: null, pageId: null, pageTitle: '' };
const hideIconHint = bindIconHints($('icon-hint'));
const directory = discussionDirectory(context, { openDiscussion, setView, feedback });
const threadActions = $('thread-actions');
threadActions.innerHTML = discussionActions.buttons({ compactHints: true });
const conversation = new PiConversation($('conversation'), { actions: threadActions, onRender: renderThread });
let navigation = 0;
let relatedRevision = 0;
let initialized = false;

function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}

function setView(view) {
  if (view === 'thread' && document.body.dataset.view !== 'thread') directory.leave();
  hideIconHint();
  document.body.dataset.view = view;
}

function sourceCard(open) {
  $('source-card').hidden = !open;
  $('source-toggle').setAttribute('aria-expanded', String(open));
}

function renderThread(session) {
  if (context.activeId !== session.id) return;
  const source = session.source;
  context.activeSourceId = session.sourceId;
  if ($('panel-title').textContent !== session.title) $('panel-title').textContent = session.title;
  $('source-toggle').disabled = false;
  threadActions.disabled = false;
  if ($('source-card').dataset.sessionId !== session.id) {
    $('source-card').dataset.sessionId = session.id;
    $('source-link').href = source.citationUrl || source.url;
    $('source-link').textContent = source.title || source.url;
    $('source-quote').textContent = source.selection;
  }
  $('other-page').hidden = source.id === context.pageId;
}

function showRelated(id) {
  relatedRevision++;
  context.relatedId = id;
  $('list-toggle').classList.toggle('related', Boolean(id));
}

function backToList() {
  navigation++;
  conversation.hide();
  setView('list');
  sourceCard(false);
  directory.enter();
  const entry = document.querySelector('.discussion.active .discussion-open');
  (entry?.checkVisibility() ? entry : $('scope').querySelector(':checked')).focus({ preventScroll: true });
}

async function showDiscussion(id, { activate = false, relatedId = null } = {}) {
  const epoch = ++navigation;
  conversation.hide();
  context.activeId = id;
  showRelated(relatedId);
  sourceCard(false);
  $('panel-title').textContent = '';
  $('source-toggle').disabled = true;
  threadActions.disabled = true;
  setView('thread');
  if (activate) $('list-toggle').focus();
  try {
    if (activate) await PiBrowser.request('activate', { sessionId: id });
    if (epoch !== navigation) return;
    const input = await PiBrowser.request('panelInput', { sessionId: id });
    conversation.acceptInput(id, input);
    if (epoch !== navigation) return;
    await conversation.show(id);
    if (epoch === navigation) feedback('');
  } catch (error) {
    if (epoch !== navigation) return;
    backToList();
    feedback(error.message, true);
  }
}

function openDiscussion(id) {
  return showDiscussion(id, { activate: true });
}

function forgetDiscussion() {
  navigation++;
  context.activeId = context.activeSourceId = null;
  conversation.hide();
  if (document.body.dataset.view === 'thread') backToList();
}

async function load() {
  const epoch = navigation;
  const revision = relatedRevision;
  try {
    const snapshot = await PiBrowser.request('snapshot');
    if (epoch !== navigation) return;
    const relatedId = revision === relatedRevision ? snapshot.relatedId : context.relatedId;
    const showActive = snapshot.activeId && (!initialized || document.body.dataset.view === 'thread');
    initialized = true;
    if (showActive) await showDiscussion(snapshot.activeId, { relatedId });
    else {
      showRelated(relatedId);
      context.activeId = snapshot.activeId;
      if (!context.activeId) forgetDiscussion();
      await directory.refresh();
    }
  } catch (error) { feedback(error.message, true); }
}

async function currentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = tabSource(tab);
  const changed = context.pageId !== id;
  const title = tab?.title || (id && new URL(id).hostname) || '';
  const renamed = context.pageTitle !== title;
  context.pageId = id;
  context.pageTitle = title;
  $('other-page').hidden = !context.activeId || id === context.activeSourceId;
  if (initialized && changed) directory.pageChanged();
  else if (initialized && renamed) directory.render();
}

const unsubscribe = PiBrowser.subscribe(event => {
  if (event.type === 'removed' || event.type === 'sessions') {
    const removed = event.type === 'removed' ? event.sessionIds : event.change?.deleted ? event.change.sessionIds || [event.change.sessionId] : [];
    if (removed.includes(context.relatedId)) showRelated(null);
    if (removed.includes(context.activeId)) forgetDiscussion();
    directory.changed(event.sourceId || event.change?.sourceId, removed);
  } else if (event.type === 'panel-session') {
    initialized = true;
    showDiscussion(event.sessionId).catch(error => feedback(error.message, true));
  } else if (event.type === 'related') {
    showRelated(event.sessionId);
    directory.render();
  } else if (event.type === 'connection') load();
});

$('conversation').addEventListener('pi-conversation-forked', event => openDiscussion(event.detail.id));
$('list-toggle').addEventListener('click', backToList);
$('source-toggle').addEventListener('click', () => sourceCard($('source-card').hidden));
$('settings').addEventListener('click', () => PiBrowser.request('settings').catch(error => feedback(error.message, true)));
const tabUpdated = (_id, change, tab) => { if (tab.active && (change.url || change.title || change.status === 'complete')) currentPage(); };
chrome.tabs.onActivated.addListener(currentPage);
chrome.tabs.onUpdated.addListener(tabUpdated);
window.addEventListener('pagehide', () => {
  unsubscribe();
  conversation.dispose();
  chrome.tabs.onActivated.removeListener(currentPage);
  chrome.tabs.onUpdated.removeListener(tabUpdated);
});
currentPage().catch(error => feedback(error.message, true));
load();
