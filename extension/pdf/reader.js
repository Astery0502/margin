import { getDocument, GlobalWorkerOptions } from './pdfjs/pdf.mjs';
import { EventBus, PDFViewer, PDFLinkService, PDFFindController } from './pdfjs/pdf_viewer.mjs';
import { documentUrlForReader } from './urls.js';
import { pdfInput, rememberPdf } from './files.js';
import { readingControls } from './reading-controls.js';
import { viewportRects, pdfLocation } from './anchors.js';

const documentUrl = documentUrlForReader(location.href);
const url = new URL(documentUrl);
GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
marginBrand.mountLauncher($('summary'));
const discussionTemplate = $('discussion').cloneNode(true);
$('discussion').remove();
const events = new EventBus();
const link = new PDFLinkService({ eventBus: events });
const find = new PDFFindController({ linkService: link, eventBus: events });
const lifetime = new AbortController();
const viewer = new PDFViewer({ container: $('viewer-container'), viewer: $('viewer'), eventBus: events, linkService: link, findController: find, removePageBorders: true, abortSignal: lifetime.signal });
link.setViewer(viewer);
const tab = await chrome.tabs.getCurrent();
let pdf, loadingTask, title, selected;
let ready, bodyText, lastPassage;

function error(failure) {
  if (discussions.current?.view) { discussions.current.view.error(failure); return; }
  let feedback = $('feedback');
  if (!feedback) { feedback = document.createElement('div'); feedback.id = 'feedback'; feedback.setAttribute('role', 'alert'); document.body.append(feedback); }
  feedback.textContent = failure.message;
}
function createFrame() {
  const section = discussionTemplate.cloneNode(true);
  const element = id => section.querySelector(`#${id}`);
  element('discussion-mark').innerHTML = marginBrand.icon;
  element('discussion-actions').innerHTML = discussionActions.html + discussionActions.panelButton;
  return {
    section, handle: element('discussion-handle'), root: element('conversation'), actions: element('discussion-actions'),
    contains: path => path.includes(section),
    setOpen(open) { section.hidden = !open; if (open) document.body.append(section); else section.remove(); },
    render(record) { element('discussion-title').textContent = record.session.title || record.view?.session?.title || ''; },
    remove: () => section.remove(),
  };
}
const discussions = new PiSourceDiscussions({
  sourceId: () => documentUrl,
  createFrame,
  anchor: discussionAnchor,
  readBody: body,
  top: 52,
  onError: error,
  onChange: () => { marginBrand.updateLauncher($('summary'), discussions.sessions.length); renderCapture(); overlays(); },
  dismissSelection: dismissCapture,
  containsSelection: path => path.includes($('selection-tools')),
});
const controls = readingControls({ viewer, link, events, sourceUrl: documentUrl, onError: error });
$('quick').innerHTML = passageActions.quickIcon;
$('full').innerHTML = passageActions.fullIcon;
const actionStyles = document.createElement('style');
actionStyles.textContent = discussionActions.styles + discussionWindow.styles + marginBrand.styles + marginBrand.launcherStyles;
document.head.append(actionStyles);
const hasPosition = source => source.location.kind === 'pdf';
function pageOverlay(pageView) {
  const page = pageView.div;
  page.querySelector('.pi-pdf-overlay')?.remove();
  const sessions = discussions.sessions.filter(item => hasPosition(item.source) && item.source.location.page === pageView.id && !(discussions.current?.open && item.id === discussions.current.session.id));
  if (!sessions.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'pi-pdf-overlay';
  const positions = [];
  for (const session of sessions) {
    const rect = viewportRects(session.source.location, pageView).at(-1);
    let group = positions.find(item => Math.abs(item.rect.top - rect.top) < 28 && Math.abs(item.rect.left + item.rect.width - rect.left - rect.width) < 32);
    if (!group) { group = { rect, sessions: [] }; positions.push(group); }
    group.sessions.push(session);
  }
  for (const { rect, sessions: group } of positions) {
    const right = rect.left + rect.width;
    const fits = right + 34 + (group.length - 1) * 32 <= pageView.viewport.width;
    const start = fits ? right + 6 : Math.min(right + 6 + (group.length - 1) * 32, pageView.viewport.width - 28);
    group.forEach((session, index) => {
      const marker = document.createElement('button');
      marker.className = 'pi-pdf-marker';
      marker.innerHTML = session.source.includeFullText ? passageActions.fullIcon : passageActions.quickIcon;
      marker.title = `${session.title} · Page ${pageView.id}`;
      marker.setAttribute('aria-label', `Open discussion: ${session.title}`);
      marker.dataset.sessionId = session.id;
      const placeMarker = discussions.bindMarker(marker, () => session);
      placeMarker(Math.max(0, start + (fits ? 1 : -1) * index * 32), Math.max(0, rect.top - 12), {
        left: 0, top: 0, right: pageView.viewport.width - 28, bottom: pageView.viewport.height - 28,
      });
      overlay.append(marker);
    });
  }
  page.append(overlay);
}
function overlays() {
  if (!pdf) return;
  const pages = new Set(discussions.sessions.filter(item => hasPosition(item.source)).map(item => item.source.location.page));
  for (const overlay of $('viewer').querySelectorAll('.pi-pdf-overlay')) pages.add(Number(overlay.parentElement.dataset.pageNumber));
  for (const number of pages) pageOverlay(viewer.getPageView(number - 1));
  positionDiscussion();
}
function discussionAnchor(record) {
  const discussionSource = record.session.source;
  if (!discussionSource || !hasPosition(discussionSource) || !pdf) return null;
  const pageView = viewer.getPageView(discussionSource.location.page - 1);
  const rect = viewportRects(discussionSource.location, pageView).at(-1);
  const page = pageView.div.getBoundingClientRect();
  return { left: page.left + rect.left, right: page.left + rect.left + rect.width, top: page.top + rect.top, bottom: page.top + rect.top + rect.height };
}
function positionDiscussion() { discussions.layout(); }

function renderCapture() {
  for (const id of ['quick', 'full']) {
    $(id).disabled = !PiBrowser.available || Boolean(discussions.opening) || !selected;
    $(id).setAttribute('aria-busy', String(Boolean(discussions.opening)));
  }
}
function dismissCapture() { selected = null; $('selection-tools').hidden = true; renderCapture(); }
function capture() {
  if (discussions.imageCapture.active) return;
  dismissCapture();
  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const layer = element(range.startContainer).closest('.textLayer');
  if (!layer || !range.toString().trim()) return;
  if (!layer.contains(range.endContainer)) { error(new Error('Select a passage within one page.')); return; }
  const number = Number(layer.closest('.page').dataset.pageNumber);
  const pageView = viewer.getPageView(number - 1);
  const location = pdfLocation(range, layer, pageView);
  selected = { id: documentUrl, url: documentUrl, title, selection: range.toString(), location, positionLabel: `Page ${number}`, citationUrl: `${documentUrl}#page=${number}` };
  renderCapture();
  const anchor = [...range.getClientRects()].filter(rect => rect.width && rect.height).at(-1);
  $('selection-error').hidden = true;
  $('selection-tools').hidden = false;
  const tools = $('selection-tools').getBoundingClientRect();
  $('selection-tools').style.left = `${Math.max(8, Math.min(anchor.right + 6, innerWidth - tools.width - 8))}px`;
  $('selection-tools').style.top = `${Math.max(52, Math.min(anchor.top >= tools.height + 60 ? anchor.top - tools.height - 8 : anchor.bottom + 8, innerHeight - tools.height - 8))}px`;
}
async function discuss(includeFullText) {
  if (!selected || discussions.opening) return;
  const source = selected;
  dismissCapture();
  try {
    await discussions.prepare(source, includeFullText);
    lastPassage = source;
    $('return-passage').hidden = false;
  }
  catch (failure) {
    selected ||= source;
    $('selection-tools').hidden = false;
    $('selection-error').textContent = failure.message;
    $('selection-error').hidden = false;
    renderCapture();
  }
}
async function locate(source) {
  await ready;
  if (!hasPosition(source)) return;
  const location = source.location;
  viewer.scrollPageIntoView({ pageNumber: location.page });
  const pageView = viewer.getPageView(location.page - 1);
  const first = viewportRects(location, pageView)[0];
  $('viewer-container').scrollTop = pageView.div.offsetTop + Math.max(0, first.top - 80);
  $('viewer-container').scrollLeft = pageView.div.offsetLeft + Math.max(0, first.left - 80);
  positionDiscussion();
}

$('return-passage').addEventListener('click', () => locate(lastPassage).catch(error));
events.on('pagerendered', event => { if (pdf) { pageOverlay(viewer.getPageView(event.pageNumber - 1)); positionDiscussion(); } });
events.on('scalechanging', overlays);
events.on('rotationchanging', overlays);
$('viewer-container').addEventListener('mouseup', capture);
$('viewer-container').addEventListener('keyup', event => { if (event.key !== 'Escape') capture(); });
$('viewer-container').addEventListener('scroll', () => { dismissCapture(); discussions.layout(); });
window.addEventListener('resize', () => { dismissCapture(); discussions.layout(); });
$('selection-tools').addEventListener('mousedown', event => event.preventDefault());
$('quick').addEventListener('click', () => discuss(false));
$('full').addEventListener('click', () => discuss(true));
$('summary').addEventListener('click', () => { chrome.sidePanel.open({ windowId: tab.windowId }).catch(error); dismissCapture(); });
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (file) startLoad(file.arrayBuffer().then(bytes => ({ data: new Uint8Array(bytes), docBaseUrl: documentUrl })));
  $('file').value = '';
});
$('retry').addEventListener('click', () => startLoad(Promise.resolve({ url: documentUrl, withCredentials: true })));
const unsubscribe = PiBrowser.subscribe(event => {
  if (event.type === 'connection') renderCapture();
});

function startLoad(input) {
  pdf = null; bodyText = null; lastPassage = null;
  $('return-passage').hidden = true;
  dismissCapture();
  $('file').disabled = true; $('retry').disabled = true;
  $('load-error').hidden = true; $('loading').hidden = false;
  $('feedback')?.remove();
  controls.setDocument(null);
  ready = (async () => {
    const { cached, ...parameters } = await input;
    discussions.clear();
    viewer.setDocument(null);
    await loadingTask?.destroy();
    loadingTask = getDocument({ ...parameters, cMapUrl: new URL('./pdfjs/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./pdfjs/wasm/', import.meta.url).href, iccUrl: new URL('./pdfjs/iccs/', import.meta.url).href, isEvalSupported: false });
    pdf = await loadingTask.promise;
    const metadata = await pdf.getMetadata();
    title = metadata.info.Title || decodeURIComponent(url.pathname.split('/').at(-1));
    document.title = title;
    link.setDocument(pdf);
    await controls.setDocument(pdf);
    viewer.setDocument(pdf);
    await viewer.firstPagePromise;
    if (!cached) await rememberPdf(documentUrl, pdf);
  })();
  ready.then(() => discussions.refresh().catch(error), () => {});
  ready.catch(failure => { $('load-error-text').textContent = failure.message; $('load-error').hidden = false; })
    .finally(() => { $('file').disabled = false; $('retry').disabled = false; $('loading').hidden = true; });
}
startLoad(pdfInput(documentUrl, lifetime.signal));
async function body() {
  await ready;
  bodyText ||= (async () => {
    const document = pdf;
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(`Page ${number}\n${content.items.map(item => item.str || '').join(' ')}`);
    }
    return pages.join('\n\n');
  })();
  return bodyText;
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'pi-source-content') return;
  const action = async () => {
    if (message.action === 'body') return { text: await body() };
    if (message.action !== 'locate') throw new Error('Unknown PDF source action.');
    await locate(message.source);
    return {};
  };
  action().then(respond, failure => respond({ error: failure.message }));
  return true;
});
window.addEventListener('pagehide', () => {
  discussions.dispose(); unsubscribe();
  lifetime.abort(); loadingTask?.destroy();
});
