export function sourceUrl(value) {
  const url = URL.parse(value);
  if (!url || !['http:', 'https:', 'file:'].includes(url.protocol)) return null;
  url.hash = '';
  return url.href;
}

export function readerUrl(url) {
  const source = sourceUrl(url);
  if (!source) throw new Error('Open a PDF file or a PDF website first.');
  const target = new URL(chrome.runtime.getURL('pdf/reader.html'));
  target.searchParams.set('url', source);
  return target.href;
}

export function documentUrlForReader(url) {
  const target = URL.parse(url);
  if (!target || target.origin + target.pathname !== chrome.runtime.getURL('pdf/reader.html')) return null;
  return sourceUrl(target.searchParams.get('url'));
}

export function tabSource(tab) {
  return documentUrlForReader(tab?.url) || sourceUrl(tab?.url);
}

// Cache Storage accepts HTTP keys only; document identity remains the original URL.
export function pdfCacheUrl(url) {
  return url.startsWith('file:') ? `https://pi.invalid/local-pdf?url=${encodeURIComponent(url)}` : url;
}
