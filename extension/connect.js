import { nativeHost, nativeRequest, hostMissing } from './providers/native.js';

const $ = id => document.getElementById(id);
const page = await chrome.tabs.getCurrent();
const fromPassage = location.hash === '#passage' && Number.isInteger(page?.openerTabId);
const platform = await chrome.runtime.getPlatformInfo();
let port, authTab, timer, checking;
let auto = fromPassage;
let installing = false;
let deadline = Date.now() + 120000;

function show(message, ...actions) {
  $('status').textContent = message;
  for (const id of ['accounts','install','connect','retry','cancel','disconnect','back']) $(id).hidden = !actions.includes(id);
}
function broadcast() { return chrome.runtime.sendMessage({ type: 'margin-account-changed' }); }
async function back() {
  try {
    await chrome.tabs.update(page.openerTabId, { active: true });
    await chrome.tabs.remove(page.id);
  } catch { show('Connected. Open a passage to start a discussion.', 'disconnect'); }
}
async function finish() {
  const current = port;
  port = null;
  const [active] = await chrome.tabs.query({ active: true, windowId: page.windowId });
  const mayReturn = active?.id === page.id || active?.id === authTab;
  const closing = authTab;
  authTab = undefined;
  current?.disconnect();
  if (closing != null) await chrome.tabs.remove(closing).catch(() => {});
  await broadcast();
  if (fromPassage && mayReturn) return back();
  await check();
}
function cancel(message) {
  const closing = authTab;
  authTab = undefined;
  port?.disconnect();
  port = null;
  if (closing != null) chrome.tabs.remove(closing).catch(() => {});
  show(message, ...($('account').options.length > 1 ? ['accounts'] : []), 'connect');
}
function login() {
  if (port) return;
  auto = false;
  clearTimeout(timer);
  show('Waiting for approval in ChatGPT…', 'cancel');
  const current = chrome.runtime.connectNative(nativeHost);
  port = current;
  current.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (port === current) cancel(error || 'Sign-in was interrupted. Try again.');
  });
  current.onMessage.addListener(async frame => {
    if (port !== current) return;
    if (frame.error) {
      cancel(frame.error);
      await check();
      $('status').textContent = frame.error;
      return;
    }
    if (frame.done) return finish();
    if (!frame.authorize) return;
    try {
      const url = new URL(frame.authorize);
      if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize') throw new Error('Unexpected authorization address.');
      const tab = await chrome.tabs.create({ url: url.href, openerTabId: page.id, windowId: page.windowId });
      if (port === current) authTab = tab.id;
      else await chrome.tabs.remove(tab.id);
    } catch (error) { cancel(error.message); }
  });
  current.postMessage({ op: 'login', account: $('account').value });
}
async function check() {
  if (port || checking) return;
  clearTimeout(timer);
  checking = true;
  try {
    const status = await nativeRequest('status');
    if (status.connected) {
      show('Connected to ChatGPT' + (status.email ? ' as ' + status.email : '') + '.', 'disconnect', ...(fromPassage ? ['back'] : []));
      if (auto && fromPassage) { auto = false; await broadcast(); await back(); }
      return;
    }
    const accounts = status.accounts || [];
    $('account').replaceChildren(...accounts.map(a => new Option((a.email || 'Saved account') + ' · ' + a.id.slice(-8), a.id)), new Option('Add an account', ''));
    if (status.selected) $('account').value = status.selected;
    show('Authorize Margin to use your ChatGPT plan.', ...(accounts.length ? ['accounts'] : []), 'connect');
    if (auto) login();
  } catch (error) {
    if (!hostMissing(error) || platform.os !== 'mac') {
      show(platform.os !== 'mac' ? 'Margin Connect is currently available for macOS.' : error.message, 'retry');
      return;
    }
    let download;
    try { const response = await fetch('providers/download.json'); if (response.ok) download = (await response.json()).url; } catch {}
    if (download) $('download').href = download;
    show(download ? 'Install Margin Connect once to connect this browser.' : 'Open Margin Connect from the macOS distribution, then return here.', ...(download ? ['install'] : []), 'retry');
    if (auto && Date.now() < deadline && (installing || !document.hidden)) timer = setTimeout(check, 1500);
  } finally { checking = false; }
}
$('download').onclick = () => { clearTimeout(timer); installing = true; auto = true; deadline = Date.now() + 120000; timer = setTimeout(check, 1500); };
$('connect').onclick = login;
$('cancel').onclick = () => cancel('Sign-in cancelled. Your draft is ready when you return.');
$('retry').onclick = () => { auto = true; deadline = Date.now() + 120000; check(); };
$('back').onclick = back;
$('disconnect').onclick = async () => {
  show('Disconnecting your account…');
  try {
    const stopping = chrome.runtime.sendMessage({ type: 'margin-stop-account-tasks' }).catch(() => {});
    const result = await nativeRequest('logout');
    await stopping;
    auto = false;
    await broadcast();
    await check();
    if (!result.revoked) $('status').textContent = 'Signed out locally. Confirm disconnection in ChatGPT Settings because OpenAI could not confirm revocation.';
  } catch (error) { show(error.message, 'retry'); }
};
chrome.tabs.onRemoved.addListener(id => { if (port && id === authTab) cancel('Sign-in was closed. You can try again.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && auto) check(); });
window.addEventListener('pagehide', () => { clearTimeout(timer); if (port) cancel('Sign-in closed.'); });
await check();
