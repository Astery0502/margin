import { pageSummary } from './page-summary.js';

const $ = id => document.getElementById(id);
const limit = 50;
const emptyPage = { sessions: [], sourceCounts: {}, total: 0, nextOffset: null };
const infoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.3"/></svg>';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function iconButton(hint, label, icon, action) {
  const button = element('button', '', 'icon-button');
  button.dataset.hint = hint;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.addEventListener('click', action);
  return button;
}

export function discussionDirectory(context, { openDiscussion, setView, feedback }) {
  const list = $('discussion-list');
  const selected = new Set();
  const collapsed = new Set();
  const visible = () => document.body.dataset.view !== 'thread';
  const selecting = () => document.body.dataset.view === 'selection';
  const pageScope = () => $('scope').querySelector(':checked').value === 'page';
  const filter = () => ({
    sourceId: pageScope() ? context.pageId : undefined,
    query: $('discussion-filter').value.trim(),
    archived: $('show-archived').getAttribute('aria-pressed') === 'true',
  });
  let page = emptyPage;
  let offset = 0;
  let version = 0;
  let loading = false;
  let deleting = false;
  let removedDuringSelection = null;
  const busy = () => deleting || removedDuringSelection !== null;
  let summary;
  let scroll = 0;

  function selectionControls() {
    $('selection-count').textContent = `${selected.size} selected`;
    $('delete-selected').disabled = busy() || loading || !selected.size;
    $('select-all').disabled = busy() || loading || !page.total;
    $('done-selecting').disabled = busy();
  }

  function discussionRow(session) {
    const row = element('div', '', 'discussion');
    row.dataset.sessionId = session.id;
    row.classList.toggle('active', context.activeId === session.id);
    row.classList.toggle('related', context.relatedId === session.id);
    const entry = element(selecting() ? 'label' : 'button', '', 'discussion-open');
    entry.title = session.title;
    entry.append(element('span', session.title, 'discussion-title'),
      element('span', `${session.archived ? 'Archived · ' : ''}“${session.source.selection}”`, 'discussion-quote'));
    if (selecting()) {
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.id = `select-discussion-${session.id}`;
      checkbox.setAttribute('aria-label', `Select discussion: ${session.title}`);
      checkbox.checked = selected.has(session.id);
      checkbox.disabled = busy() || loading;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(session.id);
        else selected.delete(session.id);
        selectionControls();
      });
      entry.htmlFor = checkbox.id;
      row.append(checkbox, entry);
    } else {
      entry.setAttribute('aria-current', String(context.activeId === session.id));
      entry.addEventListener('click', () => openDiscussion(session.id));
      const locate = iconButton('Locate', 'Locate passage', discussionActions.locateIcon, () =>
        PiBrowser.request('locate', { sessionId: session.id }).catch(error => feedback(error.message, true)));
      const action = session.archived ? 'Restore' : 'Archive';
      const archive = iconButton(action, action + ' discussion',
        session.archived ? discussionActions.restoreIcon : discussionActions.archiveIcon, async () => {
          archive.disabled = true;
          try { await PiBrowser.request('edit', { sessionId: session.id, archived: !session.archived }); }
          catch (error) { archive.disabled = false; feedback(error.message, true); }
        });
      row.append(entry, locate, archive);
    }
    return row;
  }

  function sourceGroup(source, sessions) {
    const group = element('section', '', 'source-group');
    group.dataset.sourceId = source.id;
    const heading = element('header', '', 'source-heading');
    const grouped = !pageScope();
    const title = source.title || new URL(source.url).hostname || source.url;
    const label = element(grouped ? 'button' : 'span', title, 'source-title');
    label.title = title;
    heading.classList.toggle('related', Boolean(context.relatedId && sessions.some(session => session.id === context.relatedId)));
    const rows = element('div');
    if (grouped) {
      rows.hidden = collapsed.has(source.id);
      label.setAttribute('aria-expanded', String(!rows.hidden));
      label.addEventListener('click', () => {
        rows.hidden = !rows.hidden;
        if (rows.hidden) collapsed.add(source.id);
        else collapsed.delete(source.id);
        label.setAttribute('aria-expanded', String(!rows.hidden));
      });
    }
    const count = page.sourceCounts[source.id] || 0;
    const amount = element('span', String(count), 'source-count');
    amount.title = `${count} matching discussions`;
    const details = iconButton('Summary', `Page summary: ${title}`, infoIcon, () => {
      summary = summary?.id === source.id ? null : pageSummary(source, feedback);
      render();
    });
    details.setAttribute('aria-expanded', String(summary?.id === source.id));
    heading.append(label, amount, details);
    group.append(heading);
    if (summary?.id === source.id) group.append(summary.node);
    for (const session of sessions) rows.append(discussionRow(session));
    group.append(rows);
    return group;
  }

  function render() {
    if (!visible()) return;
    const groups = new Map();
    if (pageScope() && context.pageId) {
      groups.set(context.pageId, { source: { id: context.pageId, url: context.pageId, title: context.pageTitle }, sessions: [] });
    }
    for (const session of page.sessions) {
      if (!groups.has(session.sourceId)) groups.set(session.sourceId, { source: session.source, sessions: [] });
      groups.get(session.sourceId).sessions.push(session);
    }
    if (!groups.has(summary?.id)) summary = null;
    const top = list.scrollTop;
    const focused = document.activeElement;
    const owner = focused.closest('[data-session-id], [data-source-id]');
    list.replaceChildren(...Array.from(groups.values(), group => sourceGroup(group.source, group.sessions)));
    if (!page.total) {
      const message = filter().query ? 'No matching discussions.' : !pageScope() ? 'No saved discussions yet.'
        : context.pageId ? 'No discussions on this page yet. Select a passage and choose Quick or Full to start one.'
          : 'Open a web page or PDF to see its discussions.';
      list.append(element('p', message, 'list-empty'));
    }
    if (owner && focused !== document.activeElement) {
      let next = focused;
      if (!focused.isConnected) {
        const key = owner.dataset.sessionId ? 'data-session-id' : 'data-source-id';
        const target = list.querySelector(`[${key}="${CSS.escape(owner.getAttribute(key))}"]`);
        const label = focused.getAttribute('aria-label');
        next = label ? target?.querySelector(`[aria-label="${CSS.escape(label)}"]`) : target?.getElementsByClassName(focused.className)[0];
      }
      next?.focus({ preventScroll: true });
    }
    list.scrollTop = top;
    $('pagination').hidden = !offset && page.nextOffset === null;
    $('previous-discussions').disabled = !offset;
    $('next-discussions').disabled = page.nextOffset === null;
    $('discussion-count').textContent = `${offset + 1}–${offset + page.sessions.length} of ${page.total}`;
    selectionControls();
  }

  async function refresh() {
    if (!visible()) return;
    const request = ++version;
    loading = true;
    selectionControls();
    try {
      const result = pageScope() && !context.pageId ? emptyPage
        : await PiBrowser.request('browse', { ...filter(), offset, limit });
      if (request !== version) return;
      if (offset && offset >= result.total) {
        offset = Math.max(0, Math.floor((result.total - 1) / limit) * limit);
        return refresh();
      }
      page = result;
    } catch (error) {
      if (request !== version) return;
      page = emptyPage;
      feedback(error.message, true);
    } finally {
      if (request === version) { loading = false; render(); }
    }
  }

  function reset() {
    removedDuringSelection = null;
    selected.clear();
    offset = scroll = list.scrollTop = 0;
    page = emptyPage;
    summary = null;
    version++;
    render();
    refresh();
  }
  $('scope').addEventListener('change', reset);
  $('discussion-filter').addEventListener('input', reset);
  $('show-archived').addEventListener('click', event => {
    const button = event.currentTarget;
    const include = !filter().archived;
    button.setAttribute('aria-pressed', String(include));
    reset();
  });
  $('search-toggle').addEventListener('click', () => {
    const bar = $('search-bar');
    bar.hidden = !bar.hidden;
    $('search-toggle').setAttribute('aria-expanded', String(!bar.hidden));
    $('search-toggle').dataset.hint = bar.hidden ? 'Search' : 'Close';
    if (!bar.hidden) $('discussion-filter').focus();
    else if ($('discussion-filter').value) { $('discussion-filter').value = ''; reset(); }
  });
  function goToPage(next) {
    offset = next;
    list.scrollTop = 0;
    refresh();
  }
  $('previous-discussions').addEventListener('click', () => goToPage(Math.max(0, offset - limit)));
  $('next-discussions').addEventListener('click', () => goToPage(page.nextOffset));

  function selectionMode(enabled) {
    selected.clear();
    summary = null;
    setView(enabled ? 'selection' : 'list');
    render();
    $(enabled ? 'done-selecting' : 'select-mode').focus();
  }
  $('select-mode').addEventListener('click', () => selectionMode(true));
  $('done-selecting').addEventListener('click', () => selectionMode(false));
  $('select-all').addEventListener('click', async () => {
    if (page.sessions.length === page.total) {
      for (const session of page.sessions) selected.add(session.id);
      render();
      return;
    }
    const removed = removedDuringSelection = new Set();
    render();
    try {
      const ids = await PiBrowser.request('matchingDiscussionIds', filter());
      if (removedDuringSelection === removed) {
        for (const id of ids) if (!removed.has(id)) selected.add(id);
      }
    } catch (error) { feedback(error.message, true); }
    finally {
      if (removedDuringSelection === removed) { removedDuringSelection = null; render(); }
    }
  });
  $('delete-selected').addEventListener('click', async () => {
    const sessionIds = [...selected];
    if (!sessionIds.length || !confirm(`Delete ${sessionIds.length} selected discussions? Their history and markers will be removed. Shared history and working files are kept.`)) return;
    deleting = true;
    render();
    try {
      const result = await PiBrowser.request('deleteDiscussions', { sessionIds });
      selected.clear();
      feedback(`Deleted ${result.count} discussions.`);
    } catch (error) { feedback(error.message, true); }
    finally { deleting = false; refresh(); }
  });

  return {
    refresh, render,
    pageChanged() { if (pageScope()) reset(); },
    leave() { scroll = list.scrollTop; removedDuringSelection = null; selected.clear(); },
    enter() {
      collapsed.delete(context.activeSourceId);
      summary?.refresh();
      render();
      list.scrollTop = scroll;
      refresh();
    },
    changed(sourceId, removed) {
      for (const id of removed) {
        selected.delete(id);
        removedDuringSelection?.add(id);
      }
      if (!visible() || (filter().sourceId && sourceId && sourceId !== context.pageId)) return;
      if (summary && (!sourceId || sourceId === summary.id)) summary.refresh();
      if (!deleting) refresh();
    },
  };
}
