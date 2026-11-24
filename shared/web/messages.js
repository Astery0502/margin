globalThis.PiMessages = (() => {
  const stylesheet = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL('shared/katex.min.css') : new URL('katex.min.css', document.currentScript.src).href;
  // Font faces in a shadow stylesheet are not registered with the document.
  const fontsReady = fetch(stylesheet).then(async response => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(await response.text());
    for (const rule of sheet.cssRules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const style = rule.style;
      const source = style.getPropertyValue('src').replace(/url\(([^)]+)\)/g, (_, path) => `url("${new URL(path.replace(/["']/g, ''), stylesheet)}")`);
      document.fonts.add(new FontFace(style.getPropertyValue('font-family'), source, {
        style: style.getPropertyValue('font-style'), weight: style.getPropertyValue('font-weight'),
      }));
    }
  });
  const styles = `
    @import url("${stylesheet}");
    .markdown{white-space:normal;overflow-wrap:anywhere}.markdown>:first-child{margin-top:0}.markdown>:last-child{margin-bottom:0}
    .markdown p,.markdown ul,.markdown ol,.markdown blockquote{margin:0 0 .8em}.markdown pre{overflow:auto;padding:12px;border-radius:7px;background:#edf1e8;white-space:pre;font-size:12px}
    .markdown code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.markdown :not(pre)>code{background:#edf1e8;padding:1px 4px;border-radius:3px}
    .markdown a{color:#35664e;text-decoration:underline;text-underline-offset:2px}.markdown table{display:block;overflow:auto;border-collapse:collapse;margin:.8em 0}.markdown th,.markdown td{border:1px solid #dce5d5;padding:6px 9px;text-align:left}
    .markdown h1,.markdown h2,.markdown h3{font:inherit;font-size:1.1em;font-weight:600;line-height:1.5;letter-spacing:normal;text-transform:none;color:inherit;margin:1em 0 .5em}
    details.message>summary{display:list-item}.message-context,.message-tool{margin-top:8px;font-size:11px}.message-context summary,.message-tool summary{cursor:pointer;color:#6b7f5e}.message-context pre,.message-tool pre{max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
    .message-images{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.message-images img{max-width:100%;max-height:220px;object-fit:contain;border:1px solid #dce5d5;border-radius:6px}
    .katex-display{overflow-x:auto;overflow-y:hidden;padding:3px 0}.katex-display>.katex{width:max-content;min-width:100%}.katex{font-size:1.05em}
    .message-quote-action{position:fixed;z-index:2147483647;display:flex;align-items:center;gap:5px;border:1px solid #c9d7bf;border-radius:7px;padding:6px 9px;background:#fcfdf8;color:#36543b;box-shadow:0 3px 12px #25351420;font:11px/1.4 sans-serif;cursor:pointer}.message-quote-action[hidden]{display:none}.message-quote-action svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  `;

  let equations;
  function equationPlaceholder(token) {
    const index = equations.push(token) - 1;
    const tag = token.type === 'displayMath' ? 'div' : 'span';
    return `<${tag} data-pi-math="${index}"></${tag}>`;
  }
  const markdown = new marked.Marked(PiMarkdownMath(marked.Tokenizer, equationPlaceholder));

  function text(message) {
    return typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  }

  function details(label, value, className) {
    const box = document.createElement('details');
    box.className = className;
    const summary = document.createElement('summary');
    summary.textContent = label;
    const content = document.createElement('pre');
    content.textContent = value;
    box.append(summary, content);
    return box;
  }

  function render(message, { showContext = true } = {}) {
    if (!['user', 'assistant', 'toolResult'].includes(message.role)) return null;
    const value = message.presentation?.text ?? text(message);
    const tools = Array.isArray(message.content) ? message.content.filter(part => part.type === 'toolCall') : [];
    const images = Array.isArray(message.content) ? message.content.filter(part => part.type === 'image') : [];
    if (!value && !tools.length && !images.length) return null;
    const toolResult = message.role === 'toolResult';
    const row = document.createElement(toolResult ? 'details' : 'article');
    row.className = `message ${message.role}`;
    const label = document.createElement(toolResult ? 'summary' : 'div');
    label.className = 'message-label speaker';
    label.textContent = message.role === 'user' ? 'You' : toolResult ? `${message.toolName || 'Tool'} result` : 'Pi';
    const body = document.createElement('div');
    body.className = 'message-body text';
    if (message.role === 'assistant') {
      body.classList.add('markdown');
      equations = [];
      body.append(DOMPurify.sanitize(markdown.parse(value), {
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_TAGS: ['div', 'span', 'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'a', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
        ALLOWED_ATTR: ['data-pi-math', 'href', 'title', 'start', 'align'],
        ALLOW_DATA_ATTR: false,
      }));
      for (const element of body.querySelectorAll('[data-pi-math]')) {
        const equation = equations[Number(element.dataset.piMath)];
        if (equation) {
          const options = { displayMode: equation.display, throwOnError: false, trust: false };
          // KaTeX disables its HTML renderer in quirks mode. Chromium renders MathML natively.
          if (document.compatMode === 'BackCompat') {
            element.innerHTML = katex.renderToString(equation.text, { ...options, output: 'mathml' });
          } else katex.render(equation.text, element, options);
        }
        element.removeAttribute('data-pi-math');
      }
      for (const link of body.querySelectorAll('a[href]')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    } else body.textContent = value;
    row.append(label, body);
    if (message.presentation?.passage) {
      const quote = document.createElement('blockquote');
      quote.className = 'message-passage';
      quote.textContent = message.presentation.passage.text;
      row.insertBefore(quote, body);
    }
    if (images.length) {
      const attachments = document.createElement('div'); attachments.className = 'message-images';
      images.forEach((image, index) => { const preview = document.createElement('img'); preview.src = `data:${image.mimeType};base64,${image.data}`; preview.alt = `Attached image ${index + 1}`; attachments.append(preview); });
      row.append(attachments);
    }
    const context = message.presentation?.context;
    if (showContext && context) row.append(details(context.label, context.text, 'message-context'));
    for (const tool of tools) row.append(details(tool.name, JSON.stringify(tool.arguments, null, 2), 'message-tool'));
    return row;
  }

  const lists = new WeakMap();
  function update(list, messages, options) {
    const previous = lists.get(list);
    const next = messages.map((message, index) => {
      if (previous?.[index]?.message === message) return previous[index];
      const signature = JSON.stringify(message);
      return previous?.[index]?.signature === signature ? { ...previous[index], message }
        : { message, signature, node: render(message, options) };
    });
    const nodes = next.map(entry => entry.node).filter(Boolean);
    if (!previous?.length || !nodes.length) list.replaceChildren();
    for (const [index, node] of nodes.entries()) {
      const current = list.children[index];
      if (current === node) continue;
      if (current) current.replaceWith(node);
      else list.append(node);
    }
    while (list.children.length > nodes.length) list.lastElementChild.remove();
    lists.set(list, next);
  }

  function quoteSelection(range, body) {
    const selected = range.cloneRange();
    const mathAt = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.katex');
    const first = mathAt(selected.startContainer), last = mathAt(selected.endContainer);
    if (first && body.contains(first)) selected.setStartBefore(first);
    if (last && body.contains(last)) selected.setEndAfter(last);
    const fragment = selected.cloneContents();
    for (const math of fragment.querySelectorAll('.katex')) {
      const latex = math.querySelector('annotation[encoding="application/x-tex"]').textContent;
      const display = math.querySelector('math').getAttribute('display') === 'block';
      math.replaceWith(document.createTextNode(display ? `\\[${latex}\\]` : `\\(${latex}\\)`));
    }
    for (const block of fragment.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,tr')) block.append('\n');
    for (const br of fragment.querySelectorAll('br')) br.replaceWith('\n');
    return fragment.textContent.trim();
  }

  function bindQuoteSelection(list, onQuote, { enabled = () => true } = {}) {
    const root = list.getRootNode();
    const scrollRoots = root === document ? [document] : [root, document];
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'message-quote-action'; button.hidden = true;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z"/><path d="M8 10h8m-4-4v8"/></svg><span>Add to conversation</span>';
    list.parentNode.append(button);
    let selected = null, selecting = false;
    const selection = () => root.getSelection?.() || document.getSelection();
    function hide() { selected = null; button.hidden = true; }
    function position() {
      if (!selected) return;
      if (!selected.body.isConnected || !enabled()) { hide(); return; }
      const range = selected.range;
      const anchor = [...range.getClientRects()].at(-1) || range.getBoundingClientRect();
      let top = 0, bottom = innerHeight;
      for (let node = list; node; node = node.parentElement) {
        if (node !== list && !['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(node).overflowY)) continue;
        const bounds = node.getBoundingClientRect();
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
      if (anchor.bottom <= top || anchor.top >= bottom) { hide(); return; }
      const bounds = button.getBoundingClientRect();
      button.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8))}px`;
      const y = anchor.bottom + 6 + bounds.height <= bottom ? anchor.bottom + 6 : anchor.top - bounds.height - 6;
      button.style.top = `${Math.max(top + 4, Math.min(y, bottom - bounds.height - 4))}px`;
      selected.anchor = anchor;
    }
    function capture() {
      const current = selection();
      if (!enabled() || !current?.rangeCount || current.isCollapsed) { hide(); return; }
      const range = current.getRangeAt(0);
      const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      const body = element?.closest('.message.assistant .message-body');
      if (!body || !list.contains(body)) { hide(); return; }
      if (!current.toString().trim()) { hide(); return; }
      if (selected?.body === body && range.compareBoundaryPoints(Range.START_TO_START, selected.range) === 0 && range.compareBoundaryPoints(Range.END_TO_END, selected.range) === 0) return;
      selected = { body, range: range.cloneRange() };
      button.hidden = true;
    }
    const contains = (rect, x, y, padding = 0) => x >= rect.left - padding && x <= rect.right + padding && y >= rect.top - padding && y <= rect.bottom + padding;
    function move(event) {
      if (!selected || selecting) return;
      const { clientX: x, clientY: y } = event;
      const nearSelection = [...selected.range.getClientRects()].some(rect => contains(rect, x, y, 6));
      if (!nearSelection) {
        if (button.hidden || !contains(button.getBoundingClientRect(), x, y, 8)) button.hidden = true;
        return;
      }
      if (!button.hidden) return;
      button.hidden = false;
      position();
    }
    function down(event) { if (!event.composedPath().includes(button)) { selecting = true; button.hidden = true; } }
    function up(event) { selecting = false; if (!event.composedPath().includes(button)) capture(); }
    function scroll() {
      const previous = selected?.anchor;
      position();
      const current = selected?.anchor;
      // A queued scroll event can arrive after hovering an unchanged selection.
      if (previous && current && (previous.top !== current.top || previous.right !== current.right || previous.bottom !== current.bottom || previous.left !== current.left)) button.hidden = true;
    }
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (!selected?.body.isConnected || !enabled()) { hide(); return; }
      const text = quoteSelection(selected.range, selected.body);
      hide(); selection().removeAllRanges(); if (text) onQuote(text);
    });
    document.addEventListener('selectionchange', capture);
    document.addEventListener('mousedown', down);
    document.addEventListener('mouseup', up);
    document.addEventListener('mousemove', move);
    root.addEventListener('keyup', capture);
    for (const target of scrollRoots) target.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('selectionchange', capture);
      document.removeEventListener('mousedown', down); document.removeEventListener('mouseup', up);
      document.removeEventListener('mousemove', move); root.removeEventListener('keyup', capture);
      for (const target of scrollRoots) target.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
      button.remove();
    };
  }

  function appendQuote(draft, text) {
    return `${draft}${draft ? '\n\n' : ''}Quoted from Pi:\n${text.split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
  }

  return { render, update, bindQuoteSelection, appendQuote, styles, fontsReady };
})();
