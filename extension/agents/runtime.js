const url = chrome.runtime.getURL('agents/host.html');
let creating;

export function taskCommand(command, options) {
  return offscreenCommand('task-command', command, options);
}

export async function offscreenCommand(type, command, { start = true } = {}) {
  const contexts = await chrome.runtime.getContexts({ documentUrls: [url] });
  if (!contexts.length) {
    if (!start && !creating) return;
    creating ??= chrome.offscreen.createDocument({ url, reasons: ['WORKERS', 'USER_MEDIA'],
      justification: 'Run reading tasks and record user-requested dictation across view changes.' }).finally(() => { creating = null; });
  }
  await creating;
  const result = await chrome.runtime.sendMessage({ type, command });
  if (result?.error) throw new Error(result.error);
  if (!result) throw new Error('The task host is unavailable. Try sending again.');
  return result.result;
}

export async function hasTaskHost() {
  return Boolean(creating || (await chrome.runtime.getContexts({ documentUrls: [url] })).length);
}
