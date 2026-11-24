(() => {
  if (document.contentType !== 'application/pdf') return;
  const origin = `chrome-extension://${chrome.runtime.id}`;
  const source = location.href;
  let reader, handoff = null;
  const host = document.createElement('div');
  host.setAttribute('data-pi-source-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{position:fixed;right:20px;bottom:20px;z-index:2147483647}${marginBrand.styles}button{display:flex;align-items:center;gap:8px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#426344;background:#f3f7ec;border:1px solid #cbd8c0;border-radius:12px;padding:10px 15px;cursor:pointer;box-shadow:0 3px 14px #25351412}button:focus-visible{outline:2px solid #6b8f60;outline-offset:3px}</style><button type="button">${marginBrand.icon}Open PDF in Margin</button>`;
  document.body.append(host);
  const button = shadow.querySelector('button');
  if (location.protocol !== 'file:') {
    button.disabled = true;
    PiBrowser.request('identifier').then(identifier => { handoff = identifier; button.disabled = false; }).catch(error => { button.textContent = error.message; });
  }
  button.addEventListener('click', () => {
    if (reader && !reader.closed) { reader.focus(); return; }
    const target = new URL(chrome.runtime.getURL('pdf/reader.html'));
    target.searchParams.set('url', source);
    if (handoff) target.searchParams.set('handoff', handoff);
    reader = window.open(target.href, '_blank');
  });
  const transfer = async event => {
    if (event.origin !== origin || event.source !== reader || event.data?.type !== 'pi-pdf-ready' || event.data.handoff !== handoff) return;
    const target = reader;
    const token = handoff;
    try {
      const response = await fetch(source, { credentials: 'include' });
      if (!response.ok) throw new Error(`The original website returned HTTP ${response.status}. Save it in the original reader, then open that PDF file in Margin.`);
      const bytes = await response.arrayBuffer();
      if (!target.closed) target.postMessage({ type: 'pi-pdf-file', handoff: token, bytes }, origin, [bytes]);
    } catch (error) {
      if (!target.closed) target.postMessage({ type: 'pi-pdf-file', handoff: token, error: error.message }, origin);
    }
  };
  window.addEventListener('message', transfer);
  const messages = (message, _sender, respond) => {
    if (message.type === 'pi-source-content' && message.action === 'selection') respond({ nativePdf: true });
  };
  chrome.runtime.onMessage.addListener(messages);
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    window.removeEventListener('message', transfer);
    chrome.runtime.onMessage.removeListener(messages);
  });
})();
