const PiSourceAnchors = (() => {
  const children = node => [...node.childNodes].filter(child => !(child.nodeType === Node.ELEMENT_NODE && child.hasAttribute('data-pi-source-ui')));
  function path(node) {
    const result = [];
    while (node !== document.body) {
      const parent = node.parentNode;
      result.unshift(children(parent).indexOf(node));
      node = parent;
    }
    return result;
  }
  function point(node, offset) {
    const original = children(node);
    return { path: path(node), offset: node.nodeType === Node.TEXT_NODE ? offset : [...node.childNodes].slice(0, offset).filter(child => original.includes(child)).length };
  }
  function nodeAt(path) { return path.reduce((node, index) => children(node)[index], document.body); }
  function offsetAt(node, offset) {
    if (node.nodeType === Node.TEXT_NODE) return offset;
    const original = children(node);
    if (offset > original.length) throw new Error('Changed document structure');
    return offset === original.length ? node.childNodes.length : [...node.childNodes].indexOf(original[offset]);
  }
  function block(range) {
    let selected = range.commonAncestorContainer;
    if (selected.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(selected, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!range.intersectsNode(node)) continue;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        if (node.data.slice(start, end).trim()) selected = node;
      }
    }
    const node = selected.nodeType === Node.ELEMENT_NODE ? selected : selected.parentElement;
    return node.closest('p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,article,section,div') || node;
  }
  function selectionRange(range = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null) {
    if (!range || range.collapsed || !range.toString().trim()) return null;
    if (!document.body.contains(range.startContainer) || !document.body.contains(range.endContainer)) return null;
    const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (container.closest('[data-pi-source-ui]')) return null;
    return range;
  }
  function source(range) {
    range = selectionRange(range);
    if (!range) return null;
    const selection = range.toString();
    const url = new URL(location.href); url.hash = '';
    const blocks = [...document.body.querySelectorAll('p,li,blockquote,pre,h1,h2,h3,h4,h5,h6')].filter(node => !node.closest('[data-pi-source-ui]'));
    return {
      id: url.href, title: document.title, url: url.href, selection,
      location: { start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset) },
      positionLabel: `Passage ${Math.max(0, blocks.indexOf(block(range))) + 1}`,
      citationUrl: `${url.href}#:~:text=${encodeURIComponent(selection)}`,
    };
  }
  function range(source) {
    try {
      const range = document.createRange();
      const start = nodeAt(source.location.start.path), end = nodeAt(source.location.end.path);
      range.setStart(start, offsetAt(start, source.location.start.offset));
      range.setEnd(end, offsetAt(end, source.location.end.offset));
      if (range.toString().trim() !== source.selection.trim()) throw new Error('Changed text');
      return range;
    } catch { throw new Error('This passage no longer matches its saved location.'); }
  }
  function locate(source) {
    const selected = range(source);
    block(selected).scrollIntoView({ behavior: 'smooth', block: 'center' });
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(selected);
  }
  function body() {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('script,style,noscript,template,[data-pi-source-ui]').forEach(node => node.remove());
    return copy.textContent.trim();
  }
  return { selectionRange, source, range, block, locate, body };
})();
