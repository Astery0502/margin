const marginBrand = {
  icon: '<svg class="margin-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2H9l-6 3V5.5a2 2 0 0 1 2-2Z"/><path d="M8 8.5h2v3a2 2 0 0 1-2 2m6-5h2v3a2 2 0 0 1-2 2"/></svg>',
  styles: '.margin-logo{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}',
  launcherStyles: '#summary{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:44px;min-height:44px;padding:10px 12px;border:1px solid #c9d8bd;border-radius:12px;background:#fcfdf8;color:#527447;box-shadow:0 3px 14px #25351412}#summary:hover{background:#edf3e4}#summary .margin-logo{width:22px;height:22px}#summary .margin-count{font-size:12px;line-height:1.4;font-variant-numeric:tabular-nums}#summary::after{content:attr(aria-label);position:absolute;right:0;bottom:calc(100% + 8px);width:max-content;max-width:min(260px,calc(100vw - 48px));padding:5px 8px;border-radius:6px;background:#36543b;color:#fff;font-size:11px;line-height:1.5;text-align:left;pointer-events:none;opacity:0}#summary:hover::after,#summary:focus-visible::after{opacity:1}',
  mountLauncher(button) {
    button.innerHTML = `${this.icon}<span class="margin-count" aria-hidden="true" hidden></span>`;
    this.updateLauncher(button, 0);
  },
  updateLauncher(button, count) {
    const number = button.querySelector('.margin-count');
    const value = String(count);
    if (number.textContent === value) return;
    number.textContent = value;
    number.hidden = count === 0;
    button.setAttribute('aria-label', count
      ? `Open discussions in Margin · ${count} saved ${count === 1 ? 'discussion' : 'discussions'} on this page`
      : 'Open discussions in Margin');
  },
};
