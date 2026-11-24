export function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(update); error ? reject(error) : resolve(); };
    const update = (id, change) => { if (id === tabId && change.status === 'complete') finish(); };
    const timer = setTimeout(() => finish(new Error('The source page did not finish loading. Open it and try again.')), 15000);
    chrome.tabs.onUpdated.addListener(update);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(); }, finish);
  });
}

export async function activateTab(tab) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  return tab;
}
