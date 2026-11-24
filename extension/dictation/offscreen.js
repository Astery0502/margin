import { DictationRecorder } from './recorder.js';

let target;
let state = { state: 'idle', sessionId: null };
const results = new Map();
function notify(event) {
  if (target) chrome.runtime.sendMessage({ type: 'voice-event', event: { ...event, sourceId: target.sourceId, owner: target.owner } }).catch(console.error);
}

async function transcribe(blob, signal) {
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
  signal.throwIfAborted();
  const samples = audio.getChannelData(0).slice();
  const worker = new Worker(new URL('./transcriber.js', import.meta.url), { type: 'module' });
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      worker.onerror = event => reject(new Error(event.message || 'The speech model could not start.'));
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.postMessage(samples, [samples.buffer]);
    });
  } finally {
    worker.terminate();
    signal.removeEventListener('abort', abort);
  }
}

const recorder = new DictationRecorder({
  prepare: async () => {}, deliver: async () => {},
  request: (_action, task, { audio }) => transcribe(audio, task.controller.signal),
  onState(value, sessionId, details) {
    state = { state: value, sessionId, ...details };
    notify({ type: 'dictation', ...state });
  },
  onError(error, sessionId) {
    state = { ...state, error: error.message, sessionId };
    notify({ type: 'dictation', ...state });
  },
  onText(text, sessionId, recordingId) {
    results.set(sessionId, { text, recordingId, sourceId: target.sourceId, owner: target.owner });
    notify({ type: 'dictation-result', sessionId });
  },
  onLevel(level, sessionId) { notify({ type: 'dictation-level', level, sessionId }); },
});

async function operate({ action, sessionId, sourceId, ids, owner, fromOwner, recordingId }) {
  if (action === 'discard') {
    const matches = (id, source) => source === sourceId && (!ids || ids.includes(id));
    for (const [id, result] of results) if (matches(id, result.sourceId)) results.delete(id);
    if (target && matches(target.sessionId, target.sourceId)) await recorder.cancel();
    return;
  }
  const result = results.get(sessionId);
  if (action === 'handoff') {
    if (result?.sourceId === sourceId && result.owner === fromOwner) result.owner = owner;
    if (target?.sessionId === sessionId && target.sourceId === sourceId && target.owner === fromOwner) {
      notify({ type: 'dictation', state: 'idle', sessionId: null });
      target.owner = owner;
      notify({ type: 'dictation', ...state });
    }
    return;
  }
  if (action === 'take' || action === 'ack') {
    if (!result || result.sourceId !== sourceId || result.owner !== owner) return null;
    if (action === 'take') return { text: result.text, recordingId: result.recordingId };
    if (result.recordingId === recordingId) results.delete(sessionId);
    return;
  }
  if (action === 'start') {
    if (recorder.task) throw new Error('Finish the current recording first.');
    const permission = await navigator.permissions.query({ name: 'microphone' });
    if (permission.state !== 'granted') return { permissionRequired: true };
    if (recorder.task) throw new Error('Finish the current recording first.');
    target = { sessionId, sourceId, owner };
    await recorder.start(sessionId);
  } else if (target?.sourceId !== sourceId || target?.sessionId !== sessionId || target?.owner !== owner) {
    if (action === 'status') return { state: 'idle', sessionId: null };
    throw new Error('Return to the draft where recording started.');
  } else if (action === 'cancel') await recorder.cancel();
  else if (action === 'stop') await recorder.stop();
  else if (action === 'retry') await recorder.retry();
  else if (action === 'audio') {
    const audio = recorder.audio();
    if (!audio) throw new Error('No recording is available.');
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = () => resolve({ audio: reader.result });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(audio);
    });
  } else if (action !== 'status') throw new Error('Unknown recording operation.');
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'voice-command' || sender.url !== chrome.runtime.getURL('background.js')) return;
  operate(message.command).then(result => respond({ result }), error => respond({ error: error.message }));
  return true;
});
