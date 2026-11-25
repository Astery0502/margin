import { offscreenCommand } from '../agents/runtime.js';
import { dictationLanguage } from './language.js';

const permissionPage = chrome.runtime.getURL('dictation/permission.html');
const permissionLock = operation => navigator.locks.request('margin-microphone-permission', operation);
const getRequest = async () => (await chrome.storage.session.get('microphoneRequest')).microphoneRequest;
async function command(data) {
  const start = data.action === 'start';
  if (start) data.language = await dictationLanguage();
  return offscreenCommand('voice-command', data, { start });
}
const idle = () => ({ state: 'idle', sessionId: null });

async function clearRequest(pending, close) {
  await chrome.storage.session.remove('microphoneRequest');
  if (close) await chrome.tabs.remove(pending.tabId).catch(() => {});
}

export async function voice(action, sessionId, sourceId, sender, recordingId, notify, owner) {
  if (!sessionId) throw new Error('Select a discussion before recording.');
  if (!owner) throw new Error('This view has no recording identifier.');
  const permissionReply = sender.url?.split('?')[0] === permissionPage;
  if (permissionReply || ['start', 'cancel', 'status'].includes(action)) {
    return permissionLock(async () => {
      const pending = await getRequest();
      if (permissionReply) {
        if (!pending || pending.tabId !== sender.tab.id || pending.sessionId !== sessionId) throw new Error('The recording request expired.');
        if (!['start', 'cancel'].includes(action)) throw new Error('Unknown permission response.');
        await clearRequest(pending, false);
        if (action === 'cancel') {
          notify({ type: 'dictation', ...idle(), owner: pending.owner, sourceId: pending.sourceId });
          return idle();
        }
        try { return await command({ action, sessionId, sourceId: pending.sourceId, owner: pending.owner }); }
        catch (error) {
          notify({ type: 'dictation', ...idle(), sessionId, owner: pending.owner, sourceId: pending.sourceId, error: error.message });
          throw error;
        }
      }
      if (!sourceId) throw new Error('Open the original draft to record.');
      if (pending) {
        const owns = pending.owner === owner && pending.sourceId === sourceId && pending.sessionId === sessionId;
        if (action === 'status') return owns ? { state: 'permission', sessionId } : idle();
        if (!owns) throw new Error('Finish the current microphone request first.');
        if (action === 'cancel') { await clearRequest(pending, true); return idle(); }
        await chrome.tabs.update(pending.tabId, { active: true });
        return { state: 'permission', sessionId };
      }
      const result = await command({ action, sessionId, sourceId, owner });
      if (!result?.permissionRequired) return result || idle();
      const tab = await chrome.tabs.create({ url: permissionPage + '?sessionId=' + encodeURIComponent(sessionId) });
      await chrome.storage.session.set({ microphoneRequest: { tabId: tab.id, sessionId, sourceId, owner } });
      return { state: 'permission', sessionId };
    });
  }
  return command({ action, sessionId, sourceId, owner, recordingId });
}

export function microphoneTabClosed(tabId, notify) {
  return permissionLock(async () => {
    const pending = await getRequest();
    if (pending?.tabId !== tabId) return;
    await clearRequest(pending, false);
    notify({ type: 'dictation', ...idle(), sourceId: pending.sourceId, owner: pending.owner });
  });
}

export function transferVoice(sessionId, sourceId, fromOwner, owner) {
  return permissionLock(async () => {
    const pending = await getRequest();
    if (pending?.sessionId === sessionId && pending.owner === fromOwner) {
      await chrome.storage.session.set({ microphoneRequest: { ...pending, owner } });
    }
    await command({ action: 'handoff', sessionId, sourceId, fromOwner, owner });
  });
}

export function discardVoice(sourceId, ids) {
  return permissionLock(async () => {
    const pending = await getRequest();
    if (pending?.sourceId === sourceId && (!ids || ids.includes(pending.sessionId))) await clearRequest(pending, true);
    await command({ action: 'discard', sourceId, ids });
  });
}
