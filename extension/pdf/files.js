import { pdfCacheUrl } from './urls.js';

let fileCache;
async function cache() {
  fileCache ||= chrome.runtime.sendMessage({ type: 'pi-pdf-cache' }).then(reply => {
    if (reply.error) throw new Error(reply.error);
    return caches.open(reply.name);
  });
  return fileCache;
}

function handoffFile(url, token, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const opener = window.opener;
    const finish = (error, bytes) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve({ data: new Uint8Array(bytes), docBaseUrl: url });
    };
    const receive = event => {
      if (event.source !== opener || event.origin !== new URL(url).origin || event.data?.type !== 'pi-pdf-file' || event.data.handoff !== token) return;
      finish(event.data.error && new Error(event.data.error), event.data.bytes);
    };
    const abort = () => finish(new Error('PDF loading was cancelled.'));
    const timer = setTimeout(() => finish(new Error('File transfer timed out. Retry from the website or open a saved PDF copy.')), 30000);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    opener.postMessage({ type: 'pi-pdf-ready', handoff: token }, new URL(url).origin);
  });
}

export async function pdfInput(url, signal) {
  if (url.startsWith('file:') && !await chrome.extension.isAllowedFileSchemeAccess()) {
    throw new Error('Enable Allow access to file URLs in the browser extension details, then retry.');
  }
  const response = await (await cache()).match(pdfCacheUrl(url));
  if (response) return { data: new Uint8Array(await response.arrayBuffer()), docBaseUrl: url, cached: true };
  const token = new URL(location.href).searchParams.get('handoff');
  if (token && window.opener && !window.opener.closed) return handoffFile(url, token, signal);
  return { url, withCredentials: true };
}

export async function rememberPdf(url, pdf) {
  await (await cache()).put(pdfCacheUrl(url), new Response(await pdf.getData(), { headers: { 'Content-Type': 'application/pdf' } }));
}
