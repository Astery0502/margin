import { documentUrlForReader } from './pdf/urls.js';

(() => {
  const $ = id => document.getElementById(id);
  const conversation = new PiConversation($('conversation'), { title: $('panel-title') });
  $('conversation').addEventListener('pi-conversation-forked', event => select(event.detail.id).catch(error => feedback(error.message, true)));
  $('empty-mark').innerHTML = marginBrand.icon;
  const state = { sessions: [], activeId: null, activeSourceId: null, relatedId: null, pageId: null, pageTitle: '', scope: 'page', listOpen: false, offset: 0, nextOffset: null, total: 0 };
  let listVersion = 0;
  let loadingList = false;
  const selected = new Set();
  const expandedPages = new Set();
  let managedPage;
  let deleting = false;
  let listRefreshPending = false;

  function element(tag, text = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  function feedback(text, error = false) {
    $('feedback').textContent = text;
    $('feedback').classList.toggle('error', error);
  }

  function refreshList() {
    if (!state.listOpen) return;
    if (deleting || managedPage?.pending) { listRefreshPending = true; return; }
    loadList().catch(error => feedback(error.message, true));
  }

  function bytes(value) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function positionPageMenu(anchor) {
    const menu = $('page-menu');
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(anchor.bottom + 5, innerHeight - bounds.height - 12))}px`;
  }

  async function pageUsage(page) {
    const result = await PiBrowser.request('storage', { sourceId: page.source.id });
    if (managedPage !== page) return;
    page.archived = result.count > 0 && result.archivedCount === result.count;
    $('page-usage').textContent = `${result.count} discussions · ${bytes(result.totalBytes)}${result.archivedCount ? ` · ${result.archivedCount} archived` : ''}`;
    $('page-history').textContent = bytes(result.historyBytes);
    $('page-text').textContent = bytes(result.sourceBytes);
    $('page-files').textContent = `${result.workingFiles} ${result.workingFiles === 1 ? 'file' : 'files'} · ${bytes(result.workingBytes)}`;
    $('page-storage').hidden = false;
    const archive = $('page-menu').querySelector('[data-page-action="archivePage"]');
    archive.querySelector('span').textContent = page.archived ? 'Restore' : 'Archive';
    archive.setAttribute('aria-label', page.archived ? 'Restore page discussions' : 'Archive page discussions');
    archive.dataset.tooltip = page.archived ? 'Restore archived discussions' : 'Archive discussions; keep all data';
    positionPageMenu(page.anchor);
  }

  async function managePage(source, button) {
    if (managedPage?.pending) return;
    const menu = $('page-menu');
    if (menu.matches(':popover-open') && managedPage?.source.id === source.id) { menu.hidePopover(); return; }
    const page = managedPage = { source, anchor: button.getBoundingClientRect(), pending: true };
    $('managed-page-title').textContent = source.title || new URL(source.url).hostname;
    $('page-usage').textContent = 'Loading page usage…';
    $('page-storage').hidden = true;
    menu.querySelectorAll('button').forEach(button => { button.disabled = true; });
    menu.showPopover();
    positionPageMenu(page.anchor);
    try {
      await pageUsage(page);
      menu.querySelectorAll('button').forEach(button => { button.disabled = false; });
    } catch (error) { $('page-usage').textContent = error.message; }
    finally { page.pending = false; if (listRefreshPending) refreshList(); }
  }

  $('page-menu').addEventListener('click', async event => {
    const action = event.target.closest('[data-page-action]')?.dataset.pageAction;
    if (!action || managedPage.pending) return;
    const page = managedPage;
    if (action === 'deletePage' && !confirm(`Delete all discussions and working files for “${page.source.title}”? This permanently removes history, saved page text, and tasks for this page. Exported copies are kept.`)) return;
    if (action === 'clearPageFiles' && !confirm(`Clear the page files for “${page.source.title}”? Working files will be deleted. Discussion history and saved page text are kept.`)) return;
    page.pending = true;
    $('page-menu').querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const result = await PiBrowser.request(action, { sourceId: page.source.id, archived: !page.archived });
      if (action === 'clearPageFiles') {
        await pageUsage(page);
        feedback('Page files cleared. Discussions and saved page text are kept.');
      } else if (action === 'exportPage') {
        const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'margin-discussions.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        feedback(`Exported ${result.discussions.length} discussions.`);
      }
      else {
        $('page-menu').hidePopover();
        if (action === 'deletePage') expandedPages.delete(page.source.id);
        if (action === 'deletePage' && state.activeSourceId === page.source.id) {
          state.activeId = null; state.activeSourceId = null;
          await PiBrowser.request('activate', { sessionId: null });
          await showConversation();
        }
        state.offset = 0;
        await loadList();
        feedback(action === 'deletePage' ? 'Page data deleted.' : page.archived ? 'Page discussions restored.' : 'Page discussions archived.');
      }
    } catch (error) { feedback(error.message, true); }
    finally {
      page.pending = false;
      $('page-menu').querySelectorAll('button').forEach(button => { button.disabled = false; });
      if (listRefreshPending) refreshList();
    }
  });

  function directory(open) {
    state.listOpen = open;
    $('directory').hidden = !open;
    const toggle = $('list-toggle');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide discussion list' : 'List discussions');
    toggle.classList.toggle('related', Boolean(state.relatedId && !open));
    $('related-dot').hidden = !state.relatedId || open;
    toggle.title = state.relatedId && !open ? 'A discussion is highlighted from its source' : open ? 'Hide discussion list' : 'List discussions';
    if (open) refreshList();
  }

  function origin() {
    $('other-page').hidden = !state.activeId || state.activeSourceId === state.pageId;
  }

  async function select(sessionId) {
    await PiBrowser.request('activate', { sessionId });
    await displayDiscussion(sessionId);
  }

  async function displayDiscussion(sessionId) {
    state.activeId = sessionId;
    state.activeSourceId = state.sessions.find(session => session.id === sessionId)?.source.id;
    state.relatedId = null;
    directory(false);
    renderList();
    await showConversation();
    feedback('');
  }

  async function showConversation() {
    $('conversation').hidden = !state.activeId;
    $('empty-state').hidden = Boolean(state.activeId);
    origin();
    if (state.activeId) {
      const id = state.activeId;
      const input = await PiBrowser.request('panelInput', { sessionId: id });
      conversation.acceptInput(id, input);
      if (id !== state.activeId) return;
      await conversation.show(id);
      state.activeSourceId = conversation.session?.source.id;
      origin();
    } else { conversation.hide(); $('panel-title').textContent = 'Discussions'; }
  }

  function locateButton(session) {
    const button = element('button', '', 'icon-button');
    button.type = 'button';
    button.title = 'Locate passage';
    button.setAttribute('aria-label', `Locate passage: ${session.title}`);
    button.innerHTML = discussionActions.locateIcon;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await PiBrowser.request('locate', { sessionId: session.id });
        feedback('');
      } catch (error) { feedback(error.message, true); }
      finally { button.disabled = false; }
    });
    return button;
  }

  function renderList() {
    origin();
    if (!state.listOpen) return;
    const groups = new Map();
    const query = $('discussion-filter').value.trim().toLocaleLowerCase();
    for (const session of state.sessions) {
      if (state.scope === 'page' && session.source.id !== state.pageId) continue;
      if (session.archived && !$('show-archived').checked) continue;
      if (!`${session.title} ${session.source.title}`.toLocaleLowerCase().includes(query)) continue;
      if (!groups.has(session.source.id)) groups.set(session.source.id, { source: session.source, sessions: [] });
      groups.get(session.source.id).sessions.push(session);
    }
    $('current-page').hidden = state.scope !== 'page';
    $('current-page').textContent = state.pageTitle || 'Open a web page to see its discussions.';
    const list = $('discussion-list');
    list.replaceChildren();
    for (const { source, sessions } of groups.values()) {
      const group = element('section', '', 'source-group');
      group.dataset.sourceId = source.id;
      group.classList.toggle('related', sessions.some(session => session.id === state.relatedId));
      const heading = element('header', '', 'source-heading');
      const toggle = element('button', '', 'source-toggle');
      toggle.type = 'button';
      toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
      const label = element('span', '', 'source-label');
      label.append(element('span', source.title || new URL(source.url).hostname, 'source-title'), element('span', new URL(source.url).hostname, 'source-domain'));
      toggle.append(label);
      toggle.title = source.title || source.url;
      if (group.classList.contains('related')) {
        const dot = element('span', '', 'source-relation');
        dot.setAttribute('aria-label', 'A discussion is highlighted from its source');
        toggle.append(dot);
      }
      const rows = element('div', '', 'source-discussions');
      rows.id = `page-discussions-${list.childElementCount}`;
      rows.hidden = !expandedPages.has(source.id);
      toggle.setAttribute('aria-expanded', String(!rows.hidden));
      toggle.setAttribute('aria-controls', rows.id);
      toggle.addEventListener('click', () => {
        rows.hidden = !rows.hidden;
        toggle.setAttribute('aria-expanded', String(!rows.hidden));
        if (rows.hidden) expandedPages.delete(source.id);
        else expandedPages.add(source.id);
      });
      const manage = element('button', '', 'icon-button page-manage');
      manage.type = 'button';
      manage.title = 'Manage page';
      manage.setAttribute('aria-label', `Manage page: ${source.title}`);
      manage.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
      manage.addEventListener('click', () => managePage(source, manage));
      heading.append(toggle, manage);
      group.append(heading, rows);
      for (const session of sessions) {
        const row = element('div', '', 'discussion');
        row.dataset.sessionId = session.id;
        row.classList.toggle('active', state.activeId === session.id);
        row.classList.toggle('related', state.relatedId === session.id);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'discussion-select';
        checkbox.checked = selected.has(session.id);
        checkbox.disabled = deleting || loadingList;
        checkbox.setAttribute('aria-label', `Select discussion: ${session.title}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(session.id);
          else selected.delete(session.id);
          renderSelection();
        });
        const open = element('button', '', 'discussion-open');
        open.type = 'button';
        open.setAttribute('aria-pressed', String(state.activeId === session.id));
        open.append(element('span', `${session.archived ? 'Archived · ' : ''}${session.title}`, 'discussion-title'), element('span', `“${session.source.selection}”`, 'discussion-quote'));
        open.addEventListener('click', () => select(session.id).catch(error => feedback(error.message, true)));
        row.append(checkbox, open, locateButton(session));
        rows.append(row);
      }
      list.append(group);
    }
    if (managedPage && !groups.has(managedPage.source.id)) $('page-menu').hidePopover();
    if (!groups.size) list.append(element('p', query ? 'No matching discussions.' : state.scope === 'page' ? 'No discussions on this page yet. Select a passage to start one.' : 'No saved web discussions yet.', 'list-empty'));
    $('previous-discussions').disabled = !state.offset;
    $('next-discussions').disabled = state.nextOffset === null;
    $('discussion-count').textContent = state.total ? `${state.offset + 1}–${state.offset + state.sessions.length} of ${state.total}` : '0 discussions';
    origin();
    renderSelection();
  }

  function listFilter() {
    return { sourceId: state.scope === 'page' ? state.pageId : undefined, query: $('discussion-filter').value.trim(), archived: $('show-archived').checked };
  }

  function renderSelection() {
    for (const checkbox of document.querySelectorAll('.discussion-select')) checkbox.disabled = deleting || loadingList;
    const count = state.sessions.filter(session => selected.has(session.id)).length;
    $('select-shown').checked = Boolean(state.sessions.length && count === state.sessions.length);
    $('select-shown').indeterminate = count > 0 && count < state.sessions.length;
    $('select-shown').disabled = deleting || loadingList || !state.sessions.length;
    $('delete-selected').disabled = deleting || loadingList || !selected.size;
    $('delete-selected').textContent = selected.size ? `Delete selected (${selected.size})` : 'Delete selected';
    $('delete-matching').disabled = deleting || loadingList || !state.total;
    $('delete-matching').textContent = $('discussion-filter').value.trim() ? 'Delete matches' : 'Delete all';
  }

  async function deleteDiscussions(all) {
    if (deleting || loadingList) return;
    const count = all ? state.total : selected.size;
    const values = all ? listFilter() : { sessionIds: [...selected] };
    const scope = all ? `${count} discussions in the current list filter, including other result pages` : `${count} selected discussions`;
    if (!confirm(`Delete ${scope}? Their page markers and discussion views will be removed. Full history still used by other discussions is kept. Working files are kept.`)) return;
    deleting = true;
    renderList();
    try {
      const result = await PiBrowser.request('deleteDiscussions', values);
      selected.clear();
      state.offset = 0;
      await loadList();
      feedback(`Deleted ${result.count} discussions.`);
    } catch (error) { feedback(error.message, true); }
    finally { deleting = false; renderList(); if (listRefreshPending) refreshList(); }
  }

  async function loadList() {
    listRefreshPending = false;
    const version = ++listVersion;
    loadingList = true;
    renderSelection();
    try {
      const page = state.scope === 'page' && !state.pageId ? { sessions: [], total: 0, nextOffset: null } : await PiBrowser.request('browse', {
        ...listFilter(), offset: state.offset, limit: 50,
      });
      if (version !== listVersion) return;
      if (state.offset && state.offset >= page.total) { state.offset = Math.max(0, Math.floor((page.total - 1) / 50) * 50); return loadList(); }
      Object.assign(state, page);
    } catch (error) {
      if (version !== listVersion) return;
      selected.clear();
      Object.assign(state, { sessions: [], total: 0, nextOffset: null });
      throw error;
    } finally {
      if (version === listVersion) { loadingList = false; renderList(); }
    }
  }

  async function currentPage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const previous = state.pageId;
    state.pageId = null;
    state.pageTitle = '';
    const sourceUrl = tab?.url && (documentUrlForReader(tab.url) || (/^(https?|file):/.test(tab.url) ? tab.url : null));
    if (sourceUrl) {
      const url = new URL(sourceUrl);
      url.hash = '';
      state.pageId = url.href;
      state.pageTitle = tab.title || url.hostname;
    }
    if (previous !== state.pageId && state.scope === 'page') { selected.clear(); state.offset = 0; if (state.listOpen) await loadList(); }
    renderList();
  }

  async function load() {
    try {
      const snapshot = await PiBrowser.request('snapshot');
      state.relatedId = snapshot.relatedId;
      state.activeId = snapshot.activeId;
      if (state.activeId) state.activeSourceId = (await PiBrowser.request('get', { sessionId: state.activeId })).source.id;
      directory(state.listOpen);
      renderList();
      await showConversation();
      feedback('');
    } catch (error) { feedback(error.message, true); }
  }

  const unsubscribe = PiBrowser.subscribe(event => {
    if (event.type === 'removed') {
      $('page-menu').hidePopover();
      for (const id of event.sessionIds) selected.delete(id);
      if (event.sessionIds.includes(state.relatedId)) state.relatedId = null;
      if (event.sessionIds.includes(state.activeId)) { state.activeId = null; state.activeSourceId = null; showConversation(); }
      directory(state.listOpen);
    } else if (event.type === 'sessions') {
      if (!event.change || event.change.sourceId === managedPage?.source.id) $('page-menu').hidePopover();
      if (event.change?.deleted && (event.change.sessionId === state.activeId || event.change.sessionIds?.includes(state.activeId))) { state.activeId = null; state.activeSourceId = null; showConversation(); }
      refreshList();
    } else if (event.type === 'panel-session') {
      displayDiscussion(event.sessionId).catch(error => feedback(error.message, true));
    } else if (event.type === 'related') {
      state.relatedId = event.sessionId;
      directory(state.listOpen);
      renderList();
    } else if (event.type === 'connection') load();
  });

  $('list-toggle').addEventListener('click', () => directory(!state.listOpen));
  $('select-shown').addEventListener('change', () => {
    for (const session of state.sessions) {
      if ($('select-shown').checked) selected.add(session.id);
      else selected.delete(session.id);
    }
    renderList();
  });
  $('delete-selected').addEventListener('click', () => deleteDiscussions(false));
  $('delete-matching').addEventListener('click', () => deleteDiscussions(true));
  const filtered = () => { selected.clear(); state.offset = 0; loadList().catch(error => feedback(error.message, true)); };
  $('discussion-filter').addEventListener('input', filtered);
  $('show-archived').addEventListener('change', filtered);
  $('previous-discussions').addEventListener('click', () => { state.offset = Math.max(0, state.offset - 50); loadList().catch(error => feedback(error.message, true)); });
  $('next-discussions').addEventListener('click', () => { state.offset = state.nextOffset; loadList().catch(error => feedback(error.message, true)); });
  $('browse').addEventListener('click', () => { state.scope = 'all'; setScope(); directory(true); });
  const settings = () => PiBrowser.request('settings').catch(error => feedback(error.message, true));
  $('settings').addEventListener('click', settings);
  $('empty-settings').addEventListener('click', settings);
  function setScope() {
    selected.clear();
    document.querySelectorAll('[data-scope]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === state.scope)));
    state.offset = 0;
    if (state.listOpen) loadList().catch(error => feedback(error.message, true));
  }
  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => { state.scope = button.dataset.scope; setScope(); }));
  chrome.tabs.onActivated.addListener(currentPage);
  const tabUpdated = (_tabId, change, tab) => { if (tab.active && (change.url || change.title || change.status === 'complete')) currentPage(); };
  chrome.tabs.onUpdated.addListener(tabUpdated);
  window.addEventListener('pagehide', () => {
    unsubscribe();
    conversation.dispose();
    chrome.tabs.onActivated.removeListener(currentPage);
    chrome.tabs.onUpdated.removeListener(tabUpdated);
  });
  currentPage().catch(error => feedback(error.message, true));
  load();
})();
