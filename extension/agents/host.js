function relayResponse(body, provider, generation, port) {
  const native = chrome.runtime.connect({ name: 'margin-response' });
  function close() { native.disconnect(); port.close(); }
  port.onmessage = close;
  native.onMessage.addListener(frame => {
    port.postMessage(frame);
    if (frame.done || frame.error) close();
  });
  native.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || 'Margin Connect disconnected.';
    port.postMessage({ error });
    port.close();
  });
  try { native.postMessage({ op: provider === 'deepseek' ? 'deepseek-response' : 'response', body, generation }); }
  catch (error) { port.postMessage({ error: error.message }); close(); }
}
// The offscreen document owns the worker across view changes and service worker suspension.
let worker;
const pending = new Map();
function startWorker() {
  worker = new Worker('worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.port) { relayResponse(data.responseBody, data.provider, data.generation, data.port); return; }
    if (data.event) { chrome.runtime.sendMessage({ type: 'task-event', event: data.event }).catch(console.error); return; }
    pending.get(data.id)?.(data);
    pending.delete(data.id);
  };
  worker.onerror = event => {
    for (const respond of pending.values()) respond({ error: event.message || 'The task worker stopped.' });
    pending.clear();
    chrome.runtime.sendMessage({ type: 'task-host-failed' }).finally(() => window.close());
  };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'task-command' || sender.url !== chrome.runtime.getURL('background.js')) return;
  if (!worker && ['closeSource', 'stopProvider'].includes(message.command.action)) { respond({}); return; }
  if (!worker) startWorker();
  const id = crypto.randomUUID();
  pending.set(id, respond);
  worker.postMessage({ id, ...message.command });
  return true;
});
