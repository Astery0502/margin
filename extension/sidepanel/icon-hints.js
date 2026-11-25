// One hint serves the toolbar and the discussion rows, including rows replaced by a list refresh.
export function bindIconHints(hint) {
  let anchor;
  let timer;
  const changes = new MutationObserver(records => {
    if (!anchor?.isConnected) hide();
    else if (records.some(record => record.type === 'attributes')) place();
  });

  function hide() {
    clearTimeout(timer);
    changes.disconnect();
    hint.hidden = true;
    anchor = null;
  }

  function place() {
    if (!anchor?.isConnected || !anchor.checkVisibility()) { hide(); return; }
    hint.textContent = anchor.dataset.hint;
    hint.hidden = false;
    const { left, width, top, bottom } = anchor.getBoundingClientRect();
    const gap = 6;
    hint.style.left = Math.max(gap, Math.min(left + (width - hint.offsetWidth) / 2, innerWidth - hint.offsetWidth - gap)) + 'px';
    hint.style.top = (bottom + gap + hint.offsetHeight <= innerHeight ? bottom + gap : Math.max(gap, top - gap - hint.offsetHeight)) + 'px';
  }

  function show(button, delay) {
    if (button === anchor && !hint.hidden) return;
    hide();
    anchor = button;
    timer = setTimeout(() => {
      place();
      if (anchor) {
        changes.observe(anchor, { attributes: true, attributeFilter: ['data-hint'] });
        if (anchor.closest('#discussion-list')) changes.observe(document.getElementById('discussion-list'), { childList: true });
      }
    }, delay);
  }

  document.addEventListener('pointerover', event => {
    const button = event.target.closest('button[data-hint]');
    if (event.pointerType !== 'touch' && button && !button.contains(event.relatedTarget)) show(button, 300);
  });
  document.addEventListener('pointerout', event => {
    if (anchor?.contains(event.target) && !anchor.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin', event => {
    if (event.target.matches('button[data-hint]:focus-visible')) show(event.target, 0);
  });
  document.addEventListener('focusout', event => { if (event.target === anchor) hide(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-hint]');
    if (event.pointerType === 'mouse' && button?.matches(':hover')) show(button, 300);
    else hide();
  }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
  return hide;
}
