export async function dictationLanguage() {
  const { dictationLanguage: language } = await chrome.storage.local.get('dictationLanguage');
  return ['en', 'zh'].includes(language) ? language : 'auto';
}

export function saveDictationLanguage(language) {
  return chrome.storage.local.set({ dictationLanguage: language });
}
