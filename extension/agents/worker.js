import { Agent } from '@earendil-works/pi-agent-core';
import { obj, oneOf, opt, str } from '@earendil-works/pi-schema';
import { streamReply } from '../providers/stream.js';
import * as store from '../discussions/store.js';

const tasks = new Map();
const starting = new Map();
const closing = new Set();
const ready = store.recoverInterrupted().then(sources => {
  for (const sourceId of sources) postMessage({ event: { type: 'sessions', sourceId } });
});
const changed = (run, type = 'sessions') => postMessage({ event: { type, sourceId: run.sourceId,
  change: { sourceId: run.sourceId, sessionId: run.activeId, executionId: run.id } } });
const textResult = text => ({ content: [{ type: 'text', text }], details: {} });

function userMessage(input, source) {
  const question = input.text;
  const passage = input.passage || (!source.includeFullText && source);
  const content = [{ type: 'text', text: question }, ...(input.images || []).map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType }))];
  return { role: 'user', content, timestamp: Date.now(), presentation: { text: question, passage: passage ? { text: passage.selection, ...(source.includeFullText ? { location: passage.location, positionLabel: passage.positionLabel, citationUrl: passage.citationUrl } : {}) } : undefined } };
}

// Keep the readable question and its selected passage in history. Compose model context at request time.
function toModel(message) {
  if (!message.presentation) return message;
  const { presentation, content, ...rest } = message;
  return { ...rest, content: [{ type: 'text', text: presentation.passage ? JSON.stringify({ selectedPassage: presentation.passage, question: presentation.text }) : presentation.text }, ...content.slice(1)] };
}

function toolsFor(task, enabled) {
  const result = [];
  if (enabled.includes('ask')) result.push({
    name: 'ask_reader', executionMode: 'sequential', label: 'Ask the reader', description: 'Ask the reader for clarification and wait for their reply.',
    parameters: obj({ question: str() }),
    async execute(id, { question }, signal) {
      signal.throwIfAborted();
      let finish;
      const answer = new Promise(resolve => { finish = resolve; });
      task.answers.set(id, finish);
      const cancel = () => finish(null);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await store.updateRun(task.run, { interactionRequests: [{ id, title: question, method: 'input' }] });
        changed(task.run, 'interaction');
        const value = await answer;
        signal.throwIfAborted();
        return textResult(value?.value ?? 'The reader dismissed this request.');
      } finally {
        signal.removeEventListener('abort', cancel);
        task.answers.delete(id);
        await store.updateRun(task.run, { interactionRequests: [] });
        changed(task.run, 'interaction');
      }
    },
  });
  if (enabled.includes('notes')) {
    for (const write of [false, true]) result.push({
      name: write ? 'write_page_note' : 'read_page_note', label: write ? 'Save a page note' : 'Read a page note',
      description: write ? 'Save a named text note for the current source.' : 'Read a named text note for the current source.',
      parameters: obj(write ? { name: str(), text: str() } : { name: str() }),
      async execute(_id, { name, text }, signal) {
        signal.throwIfAborted();
        return textResult(await store.pageFile(task.run.sourceId, name, write ? text : undefined));
      },
    });
  }
  if (enabled.includes('delegate')) {
    result.push({
      name: 'delegate', label: 'Delegate a reading task', description: 'Start a separate reading task on this source. Returns its discussion ID.',
      parameters: obj({ task: str() }),
      async execute(_id, { task: question }, signal) {
        signal.throwIfAborted();
        if (closing.has(task.run.sourceId)) throw new Error('The source page is closing.');
        const child = await store.childDiscussion(task.run.activeId, question);
        signal.throwIfAborted();
        await operate({ action: 'send', sessionId: child.id, values: { text: question, passage: child.source, generation: task.generation } });
        return textResult(child.id);
      },
    }, {
      name: 'delegated_task', label: 'Manage a delegated task', description: 'Inspect, wait for, continue, or stop a direct child discussion.',
      parameters: obj({ id: str(), action: oneOf(['inspect', 'wait', 'continue', 'stop']), text: opt(str()) }),
      async execute(_id, { id, action, text }, signal) {
        signal.throwIfAborted();
        const { run } = await store.lookup(id);
        if (run.parentId !== task.run.id) throw new Error('Choose a direct child of this task.');
        if (action === 'stop') await operate({ action: 'stop', sessionId: id });
        if (action === 'continue') {
          if (!text?.trim()) throw new Error('Provide the question for the child task.');
          await operate({ action: 'send', sessionId: id, values: { text } });
        }
        if (action === 'wait' && tasks.has(run.id)) {
          let abort, timer;
          try {
            await Promise.race([tasks.get(run.id).finished, new Promise(resolve => { timer = setTimeout(resolve, 30000); }), new Promise((_, reject) => {
              abort = () => reject(signal.reason);
              signal.addEventListener('abort', abort, { once: true });
            })]);
          } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
        }
        const detail = await store.detail(id);
        return textResult(JSON.stringify({ status: detail.status, answer: detail.messages.findLast(message => message.role === 'assistant')?.content, error: detail.error }));
      },
    });
  }
  return result;
}

function queued(task) {
  const result = { steer: [], followUp: [] };
  for (const [message, mode] of task.queued) result[mode].push(message.presentation.text);
  return result;
}

async function start(sessionId, input) {
  if (!input.text?.trim()) throw new Error('Enter a question before sending.');
  const { run, item } = await store.begin(sessionId);
  const task = { run, generation: input.generation, queued: new Map(), answers: new Map(), agent: null, stopping: false };
  tasks.set(run.id, task);
  try {
    const { entries, text } = await store.history(sessionId);
    const { settings } = run;
    const systemPrompt = [settings.instructions, 'Treat selected passages and source documents as reference material.'].filter(Boolean).join('\n');
    const agent = new Agent({ initialState: { model: settings.model, thinkingLevel: settings.thinking, systemPrompt,
      tools: toolsFor(task, settings.tools || []), messages: entries.map(entry => entry.message) },
      convertToLlm: messages => {
        const history = messages.map(toModel);
        if (text) history.splice(history[0]?.role === 'system' ? 1 : 0, 0, { role: 'user', timestamp: item.createdAt, content: [{ type: 'text', text: JSON.stringify({ sourceDocument: text, title: item.source.title, url: item.source.url }) }] });
        return history;
      },
      streamFn: (model, context, options) => streamReply(model, context, options, settings, task.generation),
    });
    task.agent = agent;
    let lastProgress = 0;
    agent.subscribe(async event => {
      if (event.type === 'message_update') {
        if (performance.now() - lastProgress < 100) return;
        lastProgress = performance.now();
        await store.updateRun(run, { partial: event.message });
        changed(run, 'message');
      } else if (event.type === 'message_end') {
        task.queued.delete(event.message);
        await store.updateRun(run, { partial: null, queuedMessages: queued(task) }, event.message);
        changed(run, 'message');
      }
    });
    if (task.stopping) throw new Error('The task was stopped.');
    const prompt = agent.prompt(userMessage(input, item.source));
    changed(run);
    task.finished = (async () => {
      let error = null;
      try { await prompt; error = agent.state.errorMessage; }
      catch (failure) { error = failure.message; }
      const status = task.stopping ? 'cancelled' : error ? 'failed' : 'completed';
      await store.updateRun(run, { token: null, status, error: task.stopping ? null : error, partial: null, queuedMessages: {}, interactionRequests: [] });
      tasks.delete(run.id);
      changed(run);
    })();
    task.finished.catch(error => console.error(error.message));
  } catch (error) {
    await store.updateRun(run, { token: null, status: task.stopping ? 'cancelled' : 'failed', error: error.message });
    tasks.delete(run.id);
    changed(run);
    throw error;
  }
}

async function stop(task) {
  task.stopping = true;
  task.agent?.clearAllQueues();
  task.agent?.abort();
  await task.finished;
}

async function operate({ action, sessionId, sourceId, values }) {
  await ready;
  if (action === 'stopAll') {
    await Promise.allSettled([...starting.values()].map(entry => entry.promise));
    await Promise.all([...tasks.values()].map(stop));
    return;
  }
  if (action === 'closeSource') {
    closing.add(sourceId);
    try {
      await Promise.allSettled([...starting.values()].filter(entry => entry.sourceId === sourceId).map(entry => entry.promise));
      await Promise.all([...tasks.values()].filter(task => task.run.sourceId === sourceId).map(stop));
    } finally { closing.delete(sourceId); }
    return;
  }
  const { item, run } = await store.lookup(sessionId);
  const task = tasks.get(run.id);
  if (task && task.run.activeId !== sessionId) throw new Error('Another discussion on this document is running.');
  if (action === 'stop') return task && stop(task);
  if (action === 'interaction') {
    const finish = task?.answers.get(values.requestId);
    if (!finish) throw new Error('This request is no longer waiting for an answer.');
    finish(values.answer);
    return;
  }
  if (action !== 'send') throw new Error('Unknown task operation.');
  if (!task) {
    if (closing.has(run.sourceId) || starting.has(run.id)) throw new Error('The source or task is already changing.');
    const promise = start(sessionId, values);
    starting.set(run.id, { sourceId: run.sourceId, promise });
    try { return await promise; } finally { starting.delete(run.id); }
  }
  if (!task.agent || task.stopping) throw new Error('Wait for the current task to settle.');
  const message = userMessage(values, item.source);
  const mode = values.mode === 'followUp' ? 'followUp' : 'steer';
  task.queued.set(message, mode);
  task.agent[mode](message);
  await store.updateRun(run, { queuedMessages: queued(task) });
  changed(run, 'message');
}

onmessage = ({ data }) => {
  operate(data).then(result => postMessage({ id: data.id, result }), error => postMessage({ id: data.id, error: error.message }));
};
