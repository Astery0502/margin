import { readerUrl, documentUrlForReader } from './urls.js';
import { pdfCacheName } from './lifecycle.js';
import { activateTab, waitForTab } from '../tabs.js';

let lifecycle;
export function configurePdfRetention(retention) { lifecycle = retention; }

async function readerTab(url) {
  const canonical = new URL(url); canonical.hash = '';
  const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL('pdf/reader.html')}*` });
  return tabs.find(tab => documentUrlForReader(tab.url) === canonical.href);
}

export async function openReader(url) {
  const tab = await readerTab(url) || await chrome.tabs.create({ url: readerUrl(url), active: false });
  return activateTab(tab);
}

export async function pdfSourceAction(action, session) {
  const tab = action === 'body' ? await readerTab(session.source.id) : await openReader(session.source.id);
  if (!tab) throw new Error('Open the PDF in Margin, then switch to Full again.');
  await waitForTab(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'pi-source-content', action, source: session.source });
  if (response.error) throw new Error(response.error);
  return action === 'body' ? { ...session, source: { ...session.source, body: response.text } } : session;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'pi-discuss-selection', title: 'Discuss selected text with Pi', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'pi-open-pdf', title: 'Open PDF in Margin', contexts: ['page', 'link'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const open = async () => {
    if (info.menuItemId === 'pi-open-pdf') return openReader(info.linkUrl || tab.url);
    if (info.menuItemId !== 'pi-discuss-selection') return;
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'pi-source-content', action: 'selection' }, { frameId: 0 });
    if (response.nativePdf) return openReader(tab.url);
    if (response.error) throw new Error(response.error);
  };
  open().catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'pi-pdf-cache') return;
  if (!sender.tab || sender.frameId !== 0 || !documentUrlForReader(sender.url)) { respond({ error: 'PDF cache is available only to the Margin reader.' }); return; }
  lifecycle.register(sender.tab.id, sender.url).then(() => respond({ name: pdfCacheName(sender.tab.id) }), error => respond({ error: error.message }));
  return true;
});
