class PiImageCapture {
  constructor({ hide, resume, cancel }) {
    this.callbacks = { hide, resume, cancel };
    this.host = document.createElement('div');
    this.host.setAttribute('data-pi-source-ui', '');
    this.host.setAttribute('data-pi-image-capture', '');
    this.host.hidden = true;
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#36543b}:host([hidden]),[hidden]{display:none!important}*{box-sizing:border-box}button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px;cursor:pointer;border:0;border-radius:6px;background:transparent;color:inherit}button:hover{background:#eaf1e1}button:focus-visible{outline:2px solid #789c64;outline-offset:2px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        :host(.capturing) #region{background:transparent;cursor:wait}:host(.capturing) #hint,:host(.capturing) #controls,:host(.capturing) #box,:host(.capturing) #error{display:none}#region{position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;background:#36543b12}#hint{position:absolute;top:12px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 100px);padding:6px 10px;border-radius:6px;background:#36543b;color:white;pointer-events:none}#controls{position:absolute;right:12px;top:12px;display:flex;gap:4px;padding:3px;background:#fffef8;border:1px solid #cbd8c0;border-radius:8px;cursor:default}#error{position:absolute;left:12px;bottom:12px;max-width:calc(100vw - 24px);margin:0;padding:6px 10px;background:#fffef8;border-radius:6px;color:#a04c36;pointer-events:none}#error:empty{display:none}#box{position:absolute;border:2px solid #426744;background:transparent;box-shadow:0 0 0 9999px #22362920;pointer-events:none}
      </style>
      <div id="region" role="dialog" aria-label="Select image region"><span id="hint">Scroll to a figure, then drag to capture. Escape cancels.</span><div id="controls"><button id="resume" type="button" aria-label="Cancel capture" title="Cancel capture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><button id="cancel" type="button" aria-label="Cancel question" title="Cancel question"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg></button></div><p id="error" role="alert"></p><div id="box" hidden></div></div>`;
    this.$ = id => shadow.getElementById(id);
    this.$('resume').addEventListener('click', () => this.finish('resume'));
    this.$('cancel').addEventListener('click', () => this.finish('cancel'));
    this.$('region').addEventListener('wheel', event => this.scroll(event), { passive: false });
    this.$('region').addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.busy || event.target.closest('#controls')) return;
      event.preventDefault();
      this.origin = { x: event.clientX, y: event.clientY };
      this.$('region').setPointerCapture(event.pointerId);
      this.draw(event);
    });
    this.$('region').addEventListener('pointermove', event => { if (this.origin) this.draw(event); });
    this.$('region').addEventListener('pointercancel', () => { this.origin = null; this.$('box').hidden = true; });
    this.$('region').addEventListener('pointerup', event => {
      if (!this.origin) return;
      const rect = this.draw(event);
      this.origin = null;
      this.$('region').releasePointerCapture(event.pointerId);
      if (rect.width < 4 || rect.height < 4) { this.$('box').hidden = true; return; }
      this.capture(rect).catch(error => {
        if (!this.view) return;
        this.busy = false; this.host.classList.remove('capturing'); this.$('box').hidden = true;
        this.$('error').textContent = error.message;
      });
    });
    this.onKey = event => {
      if (!this.active || event.key !== 'Escape') return;
      this.escapeHandled = true;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!this.busy) this.finish('resume');
    };
    this.onKeyUp = event => {
      if (event.key !== 'Escape' || (!this.active && !this.escapeHandled)) return;
      if (!this.escapeHandled && !this.busy) this.finish('resume');
      this.escapeHandled = false; event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    document.body.append(this.host);
  }

  get active() { return Boolean(this.view); }

  start(view) {
    this.view = view;
    this.onDispose = () => this.clear();
    view.root.addEventListener('pi-conversation-disposed', this.onDispose, { once: true });
    view.root.addEventListener('pi-conversation-removed', this.onDispose, { once: true });
    view.keepImageDraft = true;
    this.callbacks.hide();
    window.getSelection().removeAllRanges();
    this.$('error').textContent = ''; this.$('box').hidden = true;
    this.host.hidden = false;
    this.$('resume').focus({ preventScroll: true });
  }

  scroll(event) {
    event.preventDefault();
    if (this.busy) return;
    this.origin = null; this.$('box').hidden = true;
    this.host.style.pointerEvents = 'none';
    let target = document.elementFromPoint(event.clientX, event.clientY);
    this.host.style.pointerEvents = '';
    const dx = event.deltaX, dy = event.deltaY;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const delta = vertical ? dy : dx;
    while (target && target !== document.scrollingElement) {
      const style = getComputedStyle(target);
      const overflow = vertical ? style.overflowY : style.overflowX;
      const position = vertical ? target.scrollTop : target.scrollLeft;
      const maximum = vertical ? target.scrollHeight - target.clientHeight : target.scrollWidth - target.clientWidth;
      if (/^(auto|scroll)$/.test(overflow) && (delta < 0 ? position > 0 : delta > 0 && position < maximum)) break;
      target = target.parentElement;
    }
    target ||= document.scrollingElement;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? target.clientHeight : 1;
    target.scrollBy({ left: dx * unit, top: dy * unit, behavior: 'instant' });
  }

  draw(event) {
    const x = Math.max(0, Math.min(innerWidth, event.clientX)), y = Math.max(0, Math.min(innerHeight, event.clientY));
    const rect = { left: Math.min(this.origin.x, x), top: Math.min(this.origin.y, y), width: Math.abs(x - this.origin.x), height: Math.abs(y - this.origin.y) };
    Object.assign(this.$('box').style, Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, `${value}px`])));
    this.$('box').hidden = false;
    return rect;
  }

  async capture(rect) {
    const view = this.view;
    const width = innerWidth, height = innerHeight;
    this.busy = true; this.host.classList.add('capturing');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const screenshot = await PiBrowser.request('captureImage');
    if (this.view !== view) return;
    const image = new Image(); image.src = screenshot;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / width, scaleY = image.naturalHeight / height;
    canvas.width = Math.round(rect.width * scaleX); canvas.height = Math.round(rect.height * scaleY);
    canvas.getContext('2d').drawImage(image, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY, 0, 0, canvas.width, canvas.height);
    if (this.view !== view) return;
    await view.setImages([...view.images, { type: 'image', mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] }]);
    if (this.view !== view) return;
    this.finish('resume');
  }

  clear() {
    if (this.view) {
      this.view.root.removeEventListener('pi-conversation-disposed', this.onDispose);
      this.view.root.removeEventListener('pi-conversation-removed', this.onDispose);
    }
    this.view = null; this.origin = null; this.busy = false; this.host.hidden = true; this.host.classList.remove('capturing');
  }

  finish(action) { this.clear(); this.callbacks[action](); }

  dispose() { this.clear(); window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('keyup', this.onKeyUp, true); this.host.remove(); }
}
