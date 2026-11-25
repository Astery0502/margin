import { openDB } from 'idb';
import { findPassage } from './passages.js';

const database = openDB('margin', 1, {
  upgrade(db) {
    for (const name of ['discussions', 'executions', 'snapshots']) {
      const store = db.createObjectStore(name, { keyPath: 'id' });
      store.createIndex('source', 'sourceId');
      if (name === 'discussions') store.createIndex('execution', 'executionId');
    }
    const messages = db.createObjectStore('messages', { keyPath: 'seq', autoIncrement: true });
    messages.createIndex('execution', 'executionId');
    messages.createIndex('discussion', 'discussionId');
    db.createObjectStore('files', { keyPath: ['sourceId', 'name'] }).createIndex('source', 'sourceId');
  },
});

const stores = ['discussions', 'executions', 'snapshots', 'messages', 'files'];
const bytes = value => new Blob([JSON.stringify(value)]).size;

function summary(item, run) {
  const { agentId, model, thinking, tier } = run.settings;
  return { ...item, sessionId: run.id, parentId: run.parentId, forkedFrom: run.forkedFrom, agentId, model, thinking, tier,
    status: run.activeId === item.id ? run.status : 'idle',
    busyElsewhere: run.status === 'running' && run.activeId !== item.id,
    queuedMessages: run.activeId === item.id ? run.queuedMessages : {},
    interactionRequests: run.activeId === item.id ? run.interactionRequests : [],
    error: run.activeId === item.id ? run.error : null };
}

async function currentFull(tx, sourceId) {
  const runs = await tx.objectStore('executions').index('source').getAll(sourceId);
  const candidates = runs.filter(run => run.snapshotId && !run.forkedFrom && !run.parentId).sort((a, b) => b.createdAt - a.createdAt);
  for (const run of candidates) {
    const items = await tx.objectStore('discussions').index('execution').getAll(run.id);
    const visible = items.filter(item => !item.archived);
    if (visible.length) return { run, items: visible };
  }
}

function match(items, source) {
  const passage = findPassage(items.map(item => item.source), source);
  return items.find(item => item.source === passage);
}

export async function prepareDiscussion(source) {
  const tx = (await database).transaction(['discussions', 'executions']);
  const current = await currentFull(tx, source.id);
  if (!current) return {};
  const item = match(current.items, source);
  return { document: { id: current.run.id }, discussion: item && summary(item, current.run) };
}

export async function createDiscussion({ source, includeFullText, text, settings }) {
  const { id: sourceId, selection, location } = source;
  if (!selection?.trim() || !location || !sourceId) throw new Error('Select a passage before sending.');
  const tx = (await database).transaction(['discussions', 'executions', 'snapshots'], 'readwrite');
  const current = includeFullText && await currentFull(tx, sourceId);
  const existing = current && match(current.items, source);
  if (existing) return summary(existing, current.run);
  const id = crypto.randomUUID();
  const now = Date.now();
  let run = current?.run;
  if (!run) {
    if (includeFullText && !text?.trim()) throw new Error('Reopen this passage to capture the document text.');
    let snapshotId = null;
    if (includeFullText) {
      const snapshots = tx.objectStore('snapshots');
      const saved = (await snapshots.index('source').getAll(sourceId)).find(snapshot => snapshot.text === text);
      snapshotId = saved?.id || id;
      if (!saved) await snapshots.add({ id: snapshotId, sourceId, text });
    }
    run = { id, sourceId, snapshotId, settings, createdAt: now, status: 'idle', activeId: id };
    await tx.objectStore('executions').add(run);
  }
  const item = { id, sourceId, executionId: run.id, source: { ...source, includeFullText }, createdAt: now, title: selection.slice(0, 48), archived: false };
  await tx.objectStore('discussions').add(item);
  await tx.done;
  return summary(item, run);
}

function readBySource(store, sourceId) {
  return sourceId ? store.index('source').getAll(sourceId) : store.getAll();
}

export async function list(sourceId) {
  const tx = (await database).transaction(['discussions', 'executions']);
  const read = name => readBySource(tx.objectStore(name), sourceId);
  const [items, runs] = await Promise.all([read('discussions'), read('executions')]);
  const byId = new Map(runs.map(run => [run.id, run]));
  return items.map(item => summary(item, byId.get(item.executionId)));
}

export async function lookup(id, tx) {
  tx ??= (await database).transaction(['discussions', 'executions']);
  const item = await tx.objectStore('discussions').get(id);
  if (!item) throw Object.assign(new Error('This discussion is no longer available.'), { code: 'SESSION_NOT_FOUND' });
  return { item, run: await tx.objectStore('executions').get(item.executionId) };
}

export async function get(id) {
  const { item, run } = await lookup(id);
  return summary(item, run);
}

export async function detail(id, cursor) {
  const tx = (await database).transaction(['discussions', 'executions', 'messages']);
  const { item, run } = await lookup(id, tx);
  const index = tx.objectStore('messages').index('discussion');
  const count = await index.count(id);
  const offset = Math.min(count, Math.max(0, Math.trunc(Number(cursor)) || 0));
  const messages = [];
  if (offset < count) {
    let row = await index.openCursor(id);
    if (offset) row = await row.advance(offset);
    while (row) {
      messages.push(row.value.message);
      row = await row.continue();
    }
  }
  if (run.activeId === id && run.partial) messages.push(run.partial);
  return { ...summary(item, run), messages, messageOffset: offset, cursor: count };
}

function matchingDiscussions(items, { archived, query = '' }) {
  const search = query.toLocaleLowerCase();
  return items.filter(item => (archived || !item.archived) &&
    (!search || [item.title, item.source.title].join(' ').toLocaleLowerCase().includes(search)));
}

export async function matchingDiscussionIds(filter) {
  const store = (await database).transaction('discussions').store;
  const items = await readBySource(store, filter.sourceId);
  return matchingDiscussions(items, filter).map(item => item.id);
}

export async function browse(filter) {
  const tx = (await database).transaction(['discussions', 'executions']);
  const items = matchingDiscussions(await readBySource(tx.objectStore('discussions'), filter.sourceId), filter);
  const sourceCounts = Object.create(null);
  for (const item of items) sourceCounts[item.sourceId] = (sourceCounts[item.sourceId] || 0) + 1;
  items.sort((a, b) => b.createdAt - a.createdAt);
  const start = Math.max(0, filter.offset || 0);
  const end = start + Math.min(100, Math.max(1, filter.limit || 50));
  const page = items.slice(start, end);
  const runs = new Map();
  for (const item of page) {
    if (!runs.has(item.executionId)) runs.set(item.executionId, tx.objectStore('executions').get(item.executionId));
  }
  const sessions = await Promise.all(page.map(async item => {
    item.source.selection = item.source.selection.slice(0, 180);
    delete item.source.location;
    return summary(item, await runs.get(item.executionId));
  }));
  return { sessions, sourceCounts, total: items.length, nextOffset: end < items.length ? end : null };
}

export async function edit(id, changes) {
  const tx = (await database).transaction(['discussions', 'executions'], 'readwrite');
  const { item, run } = await lookup(id, tx);
  if ('archived' in changes) {
    item.archived = Boolean(changes.archived);
    await tx.objectStore('discussions').put(item);
  } else {
    if (run.status === 'running') throw new Error('Stop the task before changing its model.');
    run.settings = { ...run.settings, ...changes };
    await tx.objectStore('executions').put(run);
  }
  await tx.done;
  return summary(item, run);
}

export async function archivePage(sourceId, archived) {
  const tx = (await database).transaction('discussions', 'readwrite');
  for (const item of await tx.store.index('source').getAll(sourceId)) await tx.store.put({ ...item, archived });
  await tx.done;
}

export async function sourceIds() {
  const db = await database;
  const ids = new Set();
  for (const name of ['discussions', 'files']) {
    for await (const cursor of db.transaction(name).store.index('source').iterate(null, 'nextunique')) ids.add(cursor.key);
  }
  return [...ids];
}

async function deleteByIndex(store, index, value) {
  for (const key of await store.index(index).getAllKeys(value)) await store.delete(key);
}

export async function remove({ sourceId, sessionIds, wholePage, closing, ...filter }) {
  if (wholePage && !sourceId) throw new Error('Choose a source page first.');
  const tx = (await database).transaction(stores, 'readwrite');
  const discussions = tx.objectStore('discussions');
  let items = await readBySource(discussions, sourceId);
  const selected = sessionIds && new Set(sessionIds);
  if (!wholePage) items = selected ? items.filter(item => selected.has(item.id)) : matchingDiscussions(items, filter);
  const executions = tx.objectStore('executions');
  const runs = await Promise.all([...new Set(items.map(item => item.executionId))].map(id => executions.get(id)));
  if (!closing && runs.some(run => run.status === 'running')) throw new Error('Stop active tasks before deleting discussions.');
  for (const item of items) await discussions.delete(item.id);
  for (const run of runs) {
    if (await discussions.index('execution').count(run.id)) continue;
    await executions.delete(run.id);
    await deleteByIndex(tx.objectStore('messages'), 'execution', run.id);
    if (run.snapshotId && !(await executions.index('source').getAll(run.sourceId)).some(other => other.snapshotId === run.snapshotId)) await tx.objectStore('snapshots').delete(run.snapshotId);
  }
  if (wholePage) await deleteByIndex(tx.objectStore('files'), 'source', sourceId);
  await tx.done;
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.sourceId)) groups.set(item.sourceId, []);
    groups.get(item.sourceId).push(item.id);
  }
  return { count: items.length, groups };
}

export async function clearFiles(sourceId) {
  const tx = (await database).transaction(['files', 'executions'], 'readwrite');
  if ((await tx.objectStore('executions').index('source').getAll(sourceId)).some(run => run.status === 'running')) throw new Error('Stop active tasks before clearing files.');
  await deleteByIndex(tx.objectStore('files'), 'source', sourceId);
  await tx.done;
}

export async function exportPage(sourceId) {
  const tx = (await database).transaction(stores);
  const read = name => tx.objectStore(name).index('source').getAll(sourceId);
  const [discussions, executions, snapshots] = await Promise.all(['discussions', 'executions', 'snapshots'].map(read));
  const histories = await Promise.all(executions.map(run => tx.objectStore('messages').index('execution').getAll(run.id)));
  return { version: 1, sourceId, exportedAt: new Date().toISOString(), discussions, executions, snapshots, messages: histories.flat() };
}

export async function storage(sourceId) {
  const data = await exportPage(sourceId);
  const files = await (await database).getAllFromIndex('files', 'source', sourceId);
  const historyBytes = bytes([...data.discussions, ...data.executions, ...data.messages]);
  const sourceBytes = data.snapshots.reduce((n, item) => n + new Blob([item.text]).size, 0);
  const workingBytes = files.reduce((n, file) => n + file.bytes, 0);
  return { count: data.discussions.length, archivedCount: data.discussions.filter(item => item.archived).length,
    historyBytes, sourceBytes, workingFiles: files.length, workingBytes, totalBytes: historyBytes + sourceBytes + workingBytes };
}

export async function history(id) {
  const tx = (await database).transaction(['discussions', 'executions', 'snapshots', 'messages']);
  const { item, run } = await lookup(id, tx);
  const entries = await tx.objectStore('messages').index('execution').getAll(run.id);
  const snapshot = run.snapshotId && await tx.objectStore('snapshots').get(run.snapshotId);
  return { item, run, entries, text: snapshot?.text };
}

// The token identifies one run, even if a stopped discussion is immediately resumed.
export async function begin(id) {
  const tx = (await database).transaction(['discussions', 'executions'], 'readwrite');
  const { item, run } = await lookup(id, tx);
  if (run.status === 'running') throw new Error('Another task is already running in this discussion.');
  const token = crypto.randomUUID();
  Object.assign(run, { token, status: 'running', activeId: id, partial: null, error: null, queuedMessages: {}, interactionRequests: [] });
  await tx.objectStore('executions').put(run);
  await tx.done;
  return { item, run };
}

export async function updateRun(run, changes, message) {
  const tx = (await database).transaction(['executions', 'messages', 'discussions'], 'readwrite');
  const current = await tx.objectStore('executions').get(run.id);
  if (!current || current.token !== run.token) return false;
  if (message) {
    await tx.objectStore('messages').add({ executionId: run.id, discussionId: current.activeId, message });
    if (message.role === 'user') {
      const store = tx.objectStore('discussions');
      const item = await store.get(current.activeId);
      if (!item.started) {
        item.started = true;
        item.title = [...message.presentation.text.trim().replace(/\s+/g, ' ')].slice(0, 48).join('');
        await store.put(item);
      }
    }
  }
  await tx.objectStore('executions').put({ ...current, ...changes });
  await tx.done;
  return true;
}

export async function recoverInterrupted() {
  const tx = (await database).transaction(['executions', 'messages'], 'readwrite');
  const interrupted = [];
  for await (const cursor of tx.objectStore('executions')) {
    const run = cursor.value;
    if (run.status !== 'running') continue;
    interrupted.push(run.sourceId);
    if (run.partial) await tx.objectStore('messages').add({ executionId: run.id, discussionId: run.activeId, message: run.partial });
    await cursor.update({ ...run, token: null, partial: null, status: 'cancelled', error: 'The task was interrupted. Continue to resume.', queuedMessages: {}, interactionRequests: [] });
  }
  await tx.done;
  return [...new Set(interrupted)];
}

export async function fork(id) {
  const tx = (await database).transaction(['discussions', 'executions', 'messages'], 'readwrite');
  const { item, run } = await lookup(id, tx);
  if (run.status === 'running') throw new Error('Stop the task before forking.');
  const child = crypto.randomUUID();
  const now = Date.now();
  const next = { ...item, id: child, executionId: child, createdAt: now, archived: false, title: item.title + ' (fork)' };
  const branch = { ...run, id: child, activeId: child, forkedFrom: run.id, createdAt: now, token: null };
  await tx.objectStore('discussions').add(next);
  await tx.objectStore('executions').add(branch);
  const messages = tx.objectStore('messages');
  for (const entry of await messages.index('execution').getAll(run.id)) {
    await messages.add({ executionId: child, discussionId: entry.discussionId === id ? child : null, message: entry.message });
  }
  await tx.done;
  return summary(next, branch);
}

export async function pageFile(sourceId, name, text) {
  if (!name?.trim() || name.length > 256) throw new Error('Choose a file name of 1 to 256 characters.');
  const db = await database;
  if (text === undefined) {
    const file = await db.get('files', [sourceId, name]);
    if (!file) throw new Error('This page has no file with that name.');
    return file.text;
  }
  const size = new Blob([text]).size;
  await db.put('files', { sourceId, name, text, bytes: size });
  return name;
}

export async function childDiscussion(parentId, task) {
  const tx = (await database).transaction(['discussions', 'executions'], 'readwrite');
  const { item, run } = await lookup(parentId, tx);
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const child = { ...item, id, executionId: id, createdAt, started: false, archived: false, title: task.slice(0, 48) };
  const execution = { id, activeId: id, createdAt, sourceId: item.sourceId, parentId: run.id, status: 'idle',
    snapshotId: run.snapshotId, settings: { ...run.settings, tools: run.settings.tools.filter(tool => tool !== 'delegate') } };
  await tx.objectStore('discussions').add(child);
  await tx.objectStore('executions').add(execution);
  await tx.done;
  return summary(child, execution);
}
