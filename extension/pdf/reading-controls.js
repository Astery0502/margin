import { getPdfFilenameFromUrl } from './pdfjs/pdf.mjs';
import { FindState } from './pdfjs/pdf_viewer.mjs';

const $ = id => document.getElementById(id);
const icons = {
  outline: '<path d="M8 5h12M8 12h12M8 19h12M3 5h1M3 12h1M3 19h1"/>',
  find: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  previous: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>',
  fit: '<path d="M3 4v16M21 4v16M4 12h16m-12-4-4 4 4 4m8-8 4 4-4 4"/>',
  rotate: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  original: '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function readingControls({ viewer, link, events, sourceUrl, onError }) {
  let pdfDocument;
  for (const button of window.document.querySelectorAll('[data-icon]')) {
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[button.dataset.icon]}</svg>`;
  }
  $('original').href = sourceUrl;
  const compact = matchMedia('(max-width:620px)');
  const tiny = matchMedia('(max-width:400px)');
  function arrange() {
    if (tiny.matches) $('secondary-controls').append($('previous'), $('next'));
    else { $('page-controls').prepend($('previous')); $('page-controls').append($('next')); }
    if ($('more-menu').matches(':popover-open')) $('more-menu').hidePopover();
    $('more').hidden = !compact.matches;
    if (compact.matches) $('more-menu').append($('secondary-controls'));
    else $('reading-toolbar').insertBefore($('secondary-controls'), $('more'));
  }
  compact.addEventListener('change', arrange);
  tiny.addEventListener('change', arrange);
  arrange();

  function resize() {
    if (['page-width', 'page-fit'].includes(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue;
  }
  $('outline-toggle').addEventListener('click', () => {
    const open = $('outline').hidden;
    $('outline').hidden = !open;
    $('outline-toggle').setAttribute('aria-expanded', String(open));
    window.document.body.classList.toggle('contents-open', open);
    resize();
  });
  window.addEventListener('resize', resize);

  function outlineList(items) {
    const list = window.document.createElement('ul');
    for (const item of items) {
      const entry = window.document.createElement('li');
      const anchor = window.document.createElement('a');
      anchor.textContent = item.title;
      if (item.url) link.addLinkAttributes(anchor, item.url, item.newWindow);
      else {
        anchor.href = link.getDestinationHash(item.dest);
        anchor.addEventListener('click', event => { event.preventDefault(); link.goToDestination(item.dest).catch(onError); });
      }
      if (item.items.length) {
        const group = window.document.createElement('details');
        const heading = window.document.createElement('summary');
        heading.append(anchor);
        group.append(heading, outlineList(item.items));
        entry.append(group);
      } else entry.append(anchor);
      list.append(entry);
    }
    return list;
  }
  function find(type = '', previous = false) {
    events.dispatch('find', { source: window, type, query: $('find-query').value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  $('find-query').addEventListener('input', () => find());
  $('find-query').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); find('again', event.shiftKey); }
  });
  $('find-next').addEventListener('click', () => find('again'));
  $('find-previous').addEventListener('click', () => find('again', true));
  $('find-close').addEventListener('click', () => { $('find-panel').hidePopover(); $('find-toggle').focus(); });
  $('find-panel').addEventListener('toggle', event => {
    if (event.newState === 'open') { $('find-query').focus(); $('find-query').select(); }
    else events.dispatch('findbarclose', { source: window });
  });
  function matchCount({ state, matchesCount }) {
    $('find-count').textContent = state === FindState.PENDING ? 'Searching…' : $('find-query').value ? `${matchesCount.current} / ${matchesCount.total}` : '';
  }
  events.on('updatefindmatchescount', matchCount);
  events.on('updatefindcontrolstate', matchCount);
  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && pdfDocument) {
      event.preventDefault();
      $('find-panel').showPopover();
      $('find-query').focus(); $('find-query').select();
    }
  });
  $('previous').addEventListener('click', () => { viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1); });
  $('next').addEventListener('click', () => { viewer.currentPageNumber = Math.min(pdfDocument.numPages, viewer.currentPageNumber + 1); });
  $('page').addEventListener('change', () => {
    const page = Math.max(1, Math.min(pdfDocument.numPages, Number($('page').value)));
    viewer.currentPageNumber = page;
    $('page').value = page;
  });
  $('zoom').addEventListener('change', () => { viewer.currentScaleValue = $('zoom').value; });
  $('fit').addEventListener('click', () => { viewer.currentScaleValue = 'page-width'; });
  $('rotate').addEventListener('click', () => { viewer.pagesRotation = (viewer.pagesRotation + 90) % 360; });
  $('download').addEventListener('click', async () => {
    const button = $('download');
    button.disabled = true;
    try {
      const data = await pdfDocument.getData();
      const blob = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const anchor = window.document.createElement('a');
      anchor.href = blob;
      anchor.download = getPdfFilenameFromUrl(sourceUrl);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blob), 60_000);
    } catch (error) { onError(error); }
    finally { button.disabled = !pdfDocument; }
  });
  events.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    for (const id of ['page', 'previous', 'next', 'zoom', 'fit', 'rotate', 'find-toggle', 'outline-toggle', 'download']) $(id).disabled = false;
    $('page').max = pdfDocument.numPages;
    $('page-count').textContent = `/ ${pdfDocument.numPages}`;
  });
  events.on('pagechanging', event => { $('page').value = event.pageNumber; });
  events.on('scalechanging', () => {
    const value = String(viewer.currentScaleValue);
    if ([...$('zoom').options].some(option => option.value === value)) $('zoom').value = value;
  });

  return {
    async setDocument(pdf) {
      pdfDocument = pdf;
      for (const id of ['page', 'previous', 'next', 'zoom', 'fit', 'rotate', 'find-toggle', 'outline-toggle', 'download']) $(id).disabled = true;
      $('outline-items').replaceChildren();
      $('find-query').value = ''; $('find-count').textContent = '';
      if ($('find-panel').matches(':popover-open')) $('find-panel').hidePopover();
      if (!pdf) { $('page-count').textContent = ''; return; }
      const outline = await pdf.getOutline();
      if (pdfDocument !== pdf) return;
      if (outline?.length) $('outline-items').append(outlineList(outline));
      else { const empty = window.document.createElement('p'); empty.textContent = 'This document has no table of contents.'; $('outline-items').append(empty); }
    },
  };
}
