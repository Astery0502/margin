// A native listbox keeps model browsing bounded, including in older Chromium versions.
class MarginModelPicker {
  constructor(root, label, onChoose) {
    const shadow = root.attachShadow({ mode: 'open' });
    this.label = label;
    this.onChoose = onChoose;
    shadow.innerHTML = `<style>
      :host { display:block; min-width:0; font-weight:400; }
      * { box-sizing:border-box; }
      [hidden] { display:none !important; }
      input, select, button { width:100%; min-width:0; color:inherit; font:inherit; background:white;
        border:1px solid var(--control-border,#81917a); border-radius:5px; }
      button, input { padding:5px 8px; min-height:2.3em; }
      button { display:flex; align-items:center; justify-content:space-between; gap:6px; text-align:left; cursor:pointer; }
      button::after { content:"▾"; flex:none; color:#586950; }
      button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .model-browser { display:grid; gap:4px; margin-top:4px; }
      select { display:block; appearance:auto; max-height:min(7.5em,27dvh); padding:2px; overflow:auto; }
      option { padding:2px 4px; }
      :focus-visible { outline:2px solid #648251; outline-offset:1px; }
      .fixed-model { overflow-wrap:anywhere; }
    </style><button class="model-trigger" type="button" aria-expanded="false"><span></span></button>
      <span class="fixed-model" hidden></span><div class="model-browser" hidden>
      <input type="search" aria-label="Filter models" placeholder="Filter models">
      <select size="4"></select><span class="model-empty" role="status" hidden>No matching models</span></div>`;
    this.trigger = shadow.querySelector('button');
    this.fixed = shadow.querySelector('.fixed-model');
    this.browser = shadow.querySelector('.model-browser');
    this.search = shadow.querySelector('input');
    this.list = shadow.querySelector('select');
    this.empty = shadow.querySelector('.model-empty');
    this.list.setAttribute('aria-label', label);
    this.trigger.onclick = () => this.browser.hidden ? this.open() : this.close();
    this.search.oninput = () => this.filter();
    this.list.onclick = event => { if (event.target.tagName === 'OPTION') this.choose(); };
    shadow.addEventListener('keydown', event => {
      if (this.browser.hidden || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
      if (event.target === this.search && event.key === 'ArrowDown' && !this.list.hidden) {
        event.preventDefault(); this.list.focus();
      }
      if (event.key === 'Enter' && (event.target === this.list || event.target === this.search)) {
        event.preventDefault(); this.choose();
      }
    });
    shadow.addEventListener('focusout', event => { if (!shadow.contains(event.relatedTarget)) this.close(); });
    this.items = [];
  }

  setOptions(items) {
    this.items = items;
    if (!this.browser.hidden) this.filter(this.list.value);
  }

  select(value, fallback = value) {
    this.value = value;
    const item = this.items.find(item => item.id === value);
    this.trigger.hidden = !this.items.length || (this.items.length === 1 && Boolean(item));
    this.fixed.hidden = !this.trigger.hidden;
    if (this.trigger.hidden && !this.browser.hidden) this.close();
    const name = item?.name || fallback || 'Model';
    if (this.fixed.textContent === name && this.trigger.firstElementChild.textContent === name) return;
    this.fixed.textContent = this.trigger.firstElementChild.textContent = name;
    this.trigger.setAttribute('aria-label', this.label + ': ' + name);
  }

  open() {
    this.browser.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this.filter();
    (this.search.hidden ? this.list : this.search).focus();
  }

  filter(highlight = this.value) {
    const searchable = this.items.length > 4;
    if (!searchable) this.search.value = '';
    const query = this.search.value.trim().toLowerCase();
    const matches = this.items.filter(item => (item.name + ' ' + item.id).toLowerCase().includes(query));
    const options = this.list.options;
    const changed = options.length !== matches.length || matches.some((item, i) =>
      item.id !== options[i].value || item.name !== options[i].text);
    if (changed) this.list.replaceChildren(...matches.map(item => new Option(item.name, item.id)));
    this.list.value = highlight;
    if (this.list.selectedIndex < 0) this.list.value = this.value;
    if (matches.length && this.list.selectedIndex < 0) this.list.selectedIndex = 0;
    this.list.size = Math.max(2, Math.min(4, matches.length));
    this.list.hidden = !matches.length;
    this.empty.hidden = Boolean(matches.length);
    if (!searchable && matches.length && this.search.matches(':focus')) this.list.focus();
    this.search.hidden = !searchable;
  }

  choose() {
    const value = this.list.value;
    if (!value) return;
    this.close(true);
    if (value !== this.value) this.onChoose(value);
  }

  close(refocus = false) {
    this.browser.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (refocus) this.trigger.focus();
  }
}
