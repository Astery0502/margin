const passageActions = {
  quickIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8m-8 4h5"/></svg>',
  fullIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6m-6 4h6m-6 4h6"/></svg>',
};

function bindDiscussionDismissal(dismiss) {
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  let escapedOnKeyDown = false;
  document.addEventListener('mousedown', dismiss, options);
  document.addEventListener('focusin', event => {
    // Returning from browser chrome or another app is not a page-internal focus move.
    if (event.relatedTarget) dismiss(event);
  }, options);
  document.addEventListener('focusout', event => {
    if (event.composedPath()[0].tagName === 'TEXTAREA' && !event.relatedTarget && document.hasFocus()) dismiss(event);
  }, options);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    escapedOnKeyDown = true; dismiss(event);
  }, { ...options, capture: true });
  window.addEventListener('keyup', event => {
    if (event.key !== 'Escape') return;
    if (!escapedOnKeyDown) dismiss(event);
    escapedOnKeyDown = false;
  }, { ...options, capture: true });
  return () => lifetime.abort();
}

function bindDiscussionMarker(button, { getOffset, setOffset, open, top = 8 }) {
  let anchor, drag = null, dragged = false;
  function place(left, y, limits = { left: 8, top: 8, right: innerWidth - 36, bottom: innerHeight - 36 }) {
    anchor = { left, top: y, limits };
    const offset = getOffset() || { x: 0, y: 0 };
    button.style.left = `${Math.max(limits.left, Math.min(left + offset.x, limits.right))}px`;
    button.style.top = `${Math.max(limits.top, Math.min(y + offset.y, limits.bottom))}px`;
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    dragged = false;
    drag = {
      x: event.clientX, y: event.clientY, bounds: button.getBoundingClientRect(),
      offset: { x: parseFloat(button.style.left) - anchor.left, y: parseFloat(button.style.top) - anchor.top },
    };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    dragged = true;
    const left = Math.max(8, Math.min(drag.bounds.left + dx, innerWidth - drag.bounds.width - 8));
    const y = Math.max(top, Math.min(drag.bounds.top + dy, innerHeight - drag.bounds.height - 8));
    setOffset({ x: drag.offset.x + left - drag.bounds.left, y: drag.offset.y + y - drag.bounds.top });
    place(anchor.left, anchor.top, anchor.limits);
  });
  button.addEventListener('pointerup', event => { if (drag) button.releasePointerCapture(event.pointerId); });
  button.addEventListener('lostpointercapture', () => { drag = null; });
  button.addEventListener('click', event => {
    if (dragged && event.detail) { dragged = false; event.preventDefault(); return; }
    dragged = false;
    open();
  });
  return place;
}

function bindDiscussionMovement(section, handle, move) {
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, bounds: section.getBoundingClientRect() };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => { if (drag) move(event.clientX - drag.x, event.clientY - drag.y, drag.bounds); });
  handle.addEventListener('pointerup', event => { if (drag) handle.releasePointerCapture(event.pointerId); });
  handle.addEventListener('lostpointercapture', () => { drag = null; });
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    move(event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0, event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0, section.getBoundingClientRect());
  });
}

const discussionWindow = {
  styles: '.discussion-window{position:fixed;padding-bottom:4px}.discussion-resize{position:absolute;right:1px;bottom:1px;width:18px;height:18px;padding:2px;border:0;border-radius:0 0 8px;background:transparent;color:#7d9c68;cursor:nwse-resize;touch-action:none}.discussion-resize svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}.discussion-resize:focus-visible{outline:2px solid #88a86b;outline-offset:-2px}',
  bind(section, handle, { top = 8, anchor, onResize }) {
    const resize = document.createElement('button');
    resize.type = 'button';
    resize.className = 'discussion-resize';
    resize.setAttribute('aria-label', 'Resize discussion');
    resize.title = 'Drag to resize';
    resize.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 13 8-8m-3 8 3-3"/></svg>';
    section.classList.add('discussion-window');
    section.append(resize);
    let size = null, position = null, anchored = true, drag = null, notifiedHeight = null;
    function fit(width, height) {
      const fittedWidth = Math.min(Math.max(280, width), innerWidth - 16);
      const minimumHeight = section.classList.contains('new') ? (fittedWidth <= 352 ? 88 : 54) : 160;
      return { width: fittedWidth, height: Math.min(Math.max(minimumHeight, height), innerHeight - top - 8) };
    }
    function setPosition(left, y, width, height) {
      position = {
        left: Math.max(8, Math.min(left, innerWidth - width - 8)),
        top: Math.max(top, Math.min(y, innerHeight - height - 8)),
      };
      section.style.left = `${position.left}px`;
      section.style.top = `${position.top}px`;
    }
    function place() {
      const compact = !size && section.classList.contains('new');
      const { width, height } = fit(size?.width || 500, size?.height || 480);
      section.style.width = `${width}px`;
      section.style.maxHeight = `${innerHeight - top - 8}px`;
      section.style.height = compact ? 'auto' : `${height}px`;
      if (size && height !== notifiedHeight) { notifiedHeight = height; onResize?.(height); }
      const rect = anchored && anchor();
      const left = anchored ? (rect ? rect.right + 6 : innerWidth - width - 20) : position.left;
      const y = anchored ? (rect ? rect.bottom + 6 : top + 8) : position.top;
      setPosition(left, y, width, compact ? section.getBoundingClientRect().height : height);
    }
    function changeSize(width, height) {
      size = fit(width, height);
      anchored = false;
      place();
    }
    bindDiscussionMovement(section, handle, (dx, dy, bounds) => {
      anchored = false;
      setPosition(bounds.left + dx, bounds.top + dy, bounds.width, bounds.height);
    });
    resize.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, bounds: section.getBoundingClientRect() };
      resize.setPointerCapture(event.pointerId);
    });
    resize.addEventListener('pointermove', event => {
      if (drag) changeSize(drag.bounds.width + event.clientX - drag.x, drag.bounds.height + event.clientY - drag.y);
    });
    resize.addEventListener('pointerup', event => { if (drag) resize.releasePointerCapture(event.pointerId); });
    resize.addEventListener('lostpointercapture', () => { drag = null; });
    resize.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const bounds = section.getBoundingClientRect();
      changeSize(bounds.width + (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0), bounds.height + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0));
    });
    return {
      place,
      retainPosition() { if (position) anchored = false; },
    };
  },
};
