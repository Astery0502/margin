const voiceIcons = {
  record: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  cancel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};

const composerIcons = {
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>',
  stop: voiceIcons.stop,
  continue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
};

const discussionActions = {
  locateIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
  get html() {
    return `<button data-action="locate" type="button" aria-label="Locate passage" title="Locate passage">${this.locateIcon}</button><button data-action="fork" type="button" aria-label="Fork conversation" title="Fork conversation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v12a5 5 0 0 0 5 5h5M7 8h5a5 5 0 0 0 5-5"/></svg></button><button data-action="archive" type="button" aria-label="Archive" title="Archive"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8v12h14V8M3 4h18v4H3zM9 12h6"/></svg></button>`;
  },
  get panelButton() {
    return '<button data-action="panel" type="button" aria-label="Open in side panel" title="Open in side panel"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 12h6m-3-3 3 3-3 3"/></svg></button>';
  },
  styles: '.discussion-actions{display:flex;gap:2px;flex:none;padding-right:6px}.discussion-actions button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px;border:0;border-radius:6px;background:transparent;color:#526c43}.discussion-actions button:hover{background:#eaf1e1}.discussion-actions button:disabled{opacity:.5;cursor:default}.discussion-actions button:focus-visible{outline:2px solid #88a86b;outline-offset:-2px}.discussion-actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
};

const composerHeights = { initial: 32, initialLimit: 110, followup: 42, followupLimit: 220, messages: 70 };

class PiConversation {
  constructor(root, { inline = false, actions, title, captureImages = false } = {}) {
    this.root = root;
    this.inline = inline;
    this.shadow = root.attachShadow({ mode: 'open' });
    this.version = 0;
    this.visible = true;
    this.voice = { state: 'idle' };
    this.voiceVersion = 0;
    this.voiceLevels = Array(32).fill(0);
    this.images = [];
    this.inputs = new Map();
    this.dictationReceipts = new Map();
    this.deliveredDictation = new Map();
    this.shadow.innerHTML = `
      <style>
        ${PiMessages.styles}
        ${PiExtensionUI.styles}
        ${discussionActions.styles}
        :host{display:flex;flex-direction:column;min-height:0;flex:1;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#2d4435}
        *{box-sizing:border-box}[hidden]{display:none!important}button,textarea,input{font:inherit}button{cursor:pointer;border:1px solid #d9e2d3;background:#f3f7ec;color:#426344;border-radius:7px;padding:6px 10px}button:disabled{opacity:.5;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid #6b8f60;outline-offset:2px}
        header{padding-bottom:10px;border-bottom:1px solid #dfe6d9}.heading{display:flex;align-items:start;gap:6px}h3{margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere;flex:1;min-width:0}.source-context{margin-top:5px;font-size:11px;color:#7a8d6c}.source-context summary{cursor:pointer;width:max-content}.source-context[open] summary{margin-bottom:6px}.origin{display:flex;gap:8px;align-items:start;margin-top:5px}.origin a{color:#6e8065;font-size:11px;overflow-wrap:anywhere;flex:1}blockquote{margin:10px 0;padding-left:10px;border-left:2px solid #bfceb1;font-size:12px;color:#6b7c60;max-height:85px;overflow:auto}
        #messages{flex:1;min-height:${composerHeights.messages}px;overflow:auto;overscroll-behavior:contain;padding:10px 0}.message{padding:10px 0;border-bottom:1px solid #e7ebdf;overflow-wrap:anywhere}.speaker{font-size:10px;color:#7f9073;display:block;margin-bottom:4px}.message-body:not(.markdown){white-space:pre-wrap;margin:0}.empty{color:#829077;font-size:12px}summary{cursor:pointer}
        textarea:focus-visible{outline:0}form:focus-within{border-color:#7d9c68}#model-settings{position:relative;min-width:0;max-width:180px;flex:0 1 auto;font-size:11px;color:#6b7c60}#model-summary{border:0;background:transparent;color:inherit;font:inherit;text-align:left;width:100%;display:flex;align-items:center;gap:4px;min-width:0;list-style:none;padding:4px 2px;cursor:pointer}.model-name{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.model-option{display:flex;align-items:center;flex:none;width:14px;height:14px}.model-option svg{width:100%;height:100%;fill:currentColor}.reasoning-bars rect{opacity:.2}.reasoning-bars rect.active{opacity:1}#tier-name{opacity:.3}#tier-name[data-fast="true"]{color:#698b34;opacity:1}#model-settings[data-disabled="true"] #model-summary{opacity:.6;cursor:default}.model-options{position:fixed;inset:auto;margin:0;width:260px;max-width:calc(100vw - 48px);z-index:5;border:1px solid #c9d7bf;border-radius:9px;padding:12px;background:#f8fbf4;box-shadow:0 4px 18px #233a2520}.model-options label{display:block;margin-bottom:8px}.model-options select{display:block;width:100%;min-width:0;font:inherit;color:#36523b;background:#fff;border:1px solid #d9e2d3;border-radius:5px;padding:5px}.model-options p{margin:4px 0 0;color:#7a8d6c;line-height:1.5}.actions{min-width:0}.actions{flex-wrap:nowrap!important}form{container-type:inline-size;flex-shrink:0;border:1px solid #d9e2d3;border-radius:10px;background:#f1f5eb;padding:8px;margin-top:8px}textarea{width:100%;display:block;min-height:${composerHeights.followup}px;max-height:${composerHeights.followupLimit}px;resize:none;border:0;background:transparent;color:#2d4435;line-height:1.6;padding:2px}.actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;margin-top:7px}#send{background:#365d3e;border-color:#365d3e;color:#fff}#voice-recovery{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}#voice-recovery audio{width:100%;height:32px}#voice{font-size:11px}#cancel-voice{font-size:11px}.status{font-size:11px;color:#76866a;min-height:18px;margin:6px 0 0}#error{color:#a04c36;white-space:pre-wrap}.status:empty{display:none}
        ${marginBrand.styles}
        :host(.external-title) #header{display:flex;align-items:start;gap:8px}:host(.external-title) .source-context{flex:1;min-width:0;margin-top:0}
        #draft-pi{display:none}#send,#voice{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;flex:none}#send[data-action="connect"]{width:auto;padding:3px 8px;font-size:11px}#send svg,#voice svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#voice[data-recording="true"] svg,#send[data-action="stop"] svg,#send[data-action="continue"] svg{fill:currentColor;stroke:none}
        #cancel-voice{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;border:0;background:transparent;flex:none}#cancel-voice svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}#voice-waveform{flex:1;min-width:0;height:28px;color:#526c43}#voice-waveform svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}#composer[data-dictating="true"] .actions{width:100%;margin:0}#composer[data-dictating="true"] #draft-pi{display:none!important}
        /* Keep space for the draft, mark and gaps before truncating long model names. */
        :host(.new){flex:none}:host(.new) #messages{display:none}:host(.new) .actions{max-width:100%}:host(.new) #composer{display:flex;align-items:center;gap:8px;margin:0;padding:8px 10px;border:0;background:transparent;flex-wrap:wrap}:host(.new) #draft-pi{display:block;font:20px Georgia,serif;color:#638650}:host(.new) textarea{flex:1;min-width:80px;min-height:${composerHeights.initial}px;height:${composerHeights.initial}px;max-height:${composerHeights.initialLimit}px;resize:none}:host(.new) textarea:focus-visible{outline:0}:host(.new) .actions{margin:0;flex:0 1 auto;max-width:calc(100% - 116px)}:host(.new) #composer[data-dictating="true"] .actions{flex:1;max-width:100%}:host(.new) .status{margin:0 10px 5px}
        :host(.new.resized){flex:1;min-height:0}:host(.new.resized) #composer{flex:1;min-height:0}:host(.new.resized) textarea{align-self:stretch;height:auto;max-height:none}
        :host(.new.expanded) #composer{flex-direction:column;align-items:stretch;flex-wrap:nowrap}:host(.new.expanded) #draft-pi{display:none}:host(.new.expanded) textarea{min-width:0;flex-basis:auto}:host(.new.expanded) .actions{flex:none;width:100%;max-width:none;justify-content:flex-end}:host(.new.expanded) #attached-quote,:host(.new.expanded) #images{flex:none}
        #attached-quote{flex-basis:100%;width:100%;margin:0;max-height:65px;overflow:auto}
        #images{display:flex;gap:6px;flex-wrap:wrap;flex-basis:100%;width:100%}#images:empty{display:none}#images figure{margin:0;position:relative}#images img{display:block;max-width:110px;height:72px;object-fit:contain;border:1px solid #cbd8c0;border-radius:6px}#images button{position:absolute;right:0;top:0;padding:0;width:20px;height:20px;border-radius:4px;background:#fffef8}#add-image{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;flex:none}#add-image svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}
        #activity{display:flex;align-items:center;gap:7px;flex:none;min-height:20px;margin:6px 0;color:#6b805c;font-size:11px}#activity-spinner{width:11px;height:11px;border:1.5px solid #d9e2d3;border-top-color:currentColor;border-right-color:currentColor;border-radius:50%;animation:working 1.3s linear infinite}@keyframes working{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#activity-spinner{animation:none}}
        #queued-inputs{flex:none;max-height:96px;overflow:auto;overscroll-behavior:contain;margin-top:8px}.queued-input{border-radius:8px;background:#f1f5eb;padding:8px 10px}.queued-input+.queued-input{margin-top:5px}.queued-label{display:block;font-size:11px;color:#76866a}.queued-text{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:12px}
        #keyboard-hints{display:flex;flex:none;flex-wrap:wrap;justify-content:center;gap:4px 12px;margin:5px 0 0;font-size:11px;color:#76866a}kbd{font:inherit;color:#526c43}:host(:not(.new)) #model-settings{margin-right:auto}
        @container (max-width:330px){:host(.new) textarea{flex-basis:calc(100% - 32px);min-width:0}:host(.new) .actions{flex-basis:100%;max-width:100%}}
        ${inline ? ':host(.new) .actions{padding-right:12px}' : ''}
      </style>
      <header id="header"><div class="heading"><h3 id="title">Discussion</h3><div id="header-actions" class="discussion-actions">${discussionActions.html}</div></div><details class="source-context"><summary>Source</summary><div class="origin"><a id="origin" target="_blank" rel="noreferrer"></a></div><blockquote id="quote"></blockquote></details></header>
      <div id="extension-requests" aria-live="polite"></div><div id="messages" aria-live="polite"></div>
      <div id="activity" role="status" hidden><span id="activity-spinner" aria-hidden="true"></span><span id="activity-label">Working</span></div>
      <div id="queued-inputs" aria-label="Pending messages" aria-live="polite" hidden></div>
      <form id="composer"><blockquote id="attached-quote" hidden></blockquote><div id="images" aria-label="Images attached to question"></div><span id="draft-pi" aria-hidden="true">${marginBrand.icon}</span><textarea id="draft" rows="1" aria-label="Discussion draft" placeholder="Ask about this passage…" disabled></textarea><div class="actions"><button id="cancel-voice" type="button" aria-label="Cancel dictation" title="Cancel dictation" hidden>${voiceIcons.cancel}</button><div id="voice-waveform" role="img" aria-label="Microphone activity" hidden><svg viewBox="0 0 192 28" preserveAspectRatio="none" aria-hidden="true"><path/></svg></div><div id="model-settings"><button id="model-summary" type="button" popovertarget="model-options" aria-label="Model settings"><span class="model-name" id="model-name">Model</span><span class="model-option reasoning-bars" id="thinking-name" aria-hidden="true" hidden><svg viewBox="0 0 15 14"><rect x="0" y="10" width="2" height="4"/><rect x="3" y="8" width="2" height="6"/><rect x="6" y="6" width="2" height="8"/><rect x="9" y="3" width="2" height="11"/><rect x="12" y="0" width="2" height="14"/></svg></span><span class="model-option" id="tier-name" aria-hidden="true" hidden><svg viewBox="0 0 16 16"><path d="M9 0 2 9h5l-1 7 8-10H9z"/></svg></span></button><div id="model-options" class="model-options" popover><label>Model<select id="model" aria-label="Model" disabled><option>Model</option></select></label><label id="thinking-control">Reasoning<select id="thinking" aria-label="Reasoning level" disabled></select></label><label id="tier-control">Speed<select id="tier" aria-label="Speed mode" disabled></select></label><p>Changes become the default for new conversations.</p></div></div><button id="add-image" type="button" aria-label="Add image" title="Add image" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 4-5 4 5"/></svg></button><button id="voice" type="button" aria-label="Record" title="Record" hidden>${voiceIcons.record}</button><button id="send" type="button" aria-label="Send" title="Send" disabled>${composerIcons.send}</button></div></form>
      <div id="keyboard-hints" hidden><span><kbd>Enter</kbd> <span id="submit-hint">send</span></span><span id="queue-hint" hidden><kbd>Tab</kbd> queue</span><span><kbd>Shift + Enter</kbd> new line</span></div>
      <p id="status" class="status" role="status"></p><p id="voice-status" class="status" role="status"></p><div id="voice-recovery" hidden><button id="retry-voice" type="button">Retry</button><button id="listen-voice" type="button">Listen</button><audio id="voice-audio" controls hidden></audio></div><p id="error" class="status" role="alert"></p>`;
    this.$ = id => this.shadow.getElementById(id);
    this.$('add-image').hidden = !captureImages;
    this.$('add-image').addEventListener('click', () => this.root.dispatchEvent(new Event('pi-conversation-images')));
    this.title = title || this.$('title');
    this.$('header').hidden = inline;
    this.actions = actions || this.$('header-actions');
    if (title) {
      root.classList.add('external-title');
      this.$('header').append(this.actions);
    }
    this.actions.addEventListener('click', event => {
      if (!this.session || this.pending) return;
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'locate') this.perform('locate');
      if (action === 'archive') this.perform('edit', { archived: !this.session.archived });
      if (action === 'fork') this.fork();
      if (action === 'panel') this.openPanel();
    });
    this.agentPicker = document.createElement('select');
    this.agentPicker.setAttribute('aria-label', 'Agent');
    this.$('model-options').prepend(this.agentPicker);
    this.agentPicker.addEventListener('change', () => this.changeModelSettings({ agentId: this.agentPicker.value }));
    this.unsubscribe = PiBrowser.subscribe(event => this.changed(event));
    this.unbindQuotes = PiMessages.bindQuoteSelection(this.$('messages'), text => {
      const draft = this.$('draft');
      draft.value = PiMessages.appendQuote(draft.value, text);
      this.renderActivity(); draft.focus(); draft.setSelectionRange(draft.value.length, draft.value.length);
    }, { enabled: () => this.visible && Boolean(this.id) && !this.$('draft').disabled });
    this.$('composer').addEventListener('submit', event => event.preventDefault());
    this.$('send').addEventListener('click', event => {
      if (!event.isTrusted) return;
      if (this.$('send').disabled) return;
      if (this.$('send').dataset.action === 'stop') this.perform('stop');
      else this.send();
    });
    this.$('draft').addEventListener('input', () => this.renderActivity());
    this.draftObserver = new ResizeObserver(() => this.fitDraft());
    this.draftObserver.observe(this.$('draft'));
    this.draftObserver.observe(this.root);
    this.$('draft').addEventListener('keydown', event => {
      if (!event.isTrusted || event.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.send(); }
      else if (event.key === 'Tab' && !event.shiftKey && this.session?.status === 'running' && this.hasTextDraft && this.canSend) {
        event.preventDefault(); this.send('followUp');
      }
    });
    this.$('voice').addEventListener('click', () => this.record(this.voice.state === 'recording' ? 'stop' : 'start'));
    this.$('cancel-voice').addEventListener('click', () => this.record('cancel'));
    this.$('retry-voice').addEventListener('click', () => this.record('retry'));
    this.$('listen-voice').addEventListener('click', async () => {
      try { const result = await PiBrowser.voice('audio', this.id); const audio = this.$('voice-audio'); audio.src = result.audio; audio.hidden = false; await audio.play(); }
      catch (error) { this.error(error); }
    });
    this.$('model-summary').addEventListener('click', event => {
      event.preventDefault();
      const options = this.$('model-options');
      if (options.matches(':popover-open')) { options.hidePopover(); return; }
      options.showPopover();
      this.positionModelOptions();
    });
    for (const field of ['model', 'thinking', 'tier']) this.$(field).addEventListener('change', () => {
      const values = field === 'model'
        ? { model: this.models.find(model => `${model.provider}/${model.id}` === this.$('model').value) }
        : { [field]: this.$(field).value };
      this.changeModelSettings(values);
    });
    this.extensionUI = new PiExtensionUI(this.$('extension-requests'), async (sessionId, requestId, answer) => {
      try { return await PiBrowser.request('interaction', { sessionId, requestId, answer }); }
      finally { if (this.id === sessionId) await this.refresh(); }
    });
    this.onFocus = () => { if (this.visible && !this.$('voice').hidden && !this.voiceReadiness?.ready) this.capabilities(); };
    window.addEventListener('focus', this.onFocus);
  }

  positionModelOptions() {
    const options = this.$('model-options');
    const anchor = this.$('model-summary').getBoundingClientRect();
    const bounds = options.getBoundingClientRect();
    options.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
    options.style.top = `${Math.max(8, anchor.top >= bounds.height + 8 ? anchor.top - bounds.height - 8 : Math.min(anchor.bottom + 8, innerHeight - bounds.height - 8))}px`;
  }

  async capabilities() {
    const version = this.version, id = this.id;
    const current = () => version === this.version && id === this.id;
    try {
      const capabilities = await PiBrowser.request('capabilities');
      if (!current()) return;
      const dictation = capabilities.dictation && chrome.runtime.getManifest().permissions.includes('offscreen');
      this.$('voice').hidden = !dictation;
      this.renderActivity();
      if (dictation) {
        const voiceVersion = this.voiceVersion;
        const voice = PiBrowser.voice('status', id);
        // Speech readiness is shared even when the draft becomes a saved session.
        PiBrowser.request('dictationStatus').then(status => {
          if (version === this.version) { this.voiceReadiness = status; this.renderActivity(); }
        }).catch(error => { if (current()) this.error(error); });
        const state = await voice;
        if (current() && voiceVersion === this.voiceVersion) { this.voice = state; this.renderActivity(); }
        if (current() && this.visible) await this.receiveDictation(id);
      }
    } catch (error) { if (current()) this.error(error); }
  }

  async loadModels() {
    if (this.models) return;
    try {
      const generation = this.catalogGeneration;
      const { models, defaults, agents, connected } = await PiBrowser.request('models');
      if (generation !== this.catalogGeneration) return;
      this.accountConnected = connected;
      this.agentPicker.replaceChildren(...agents.map(agent => new Option(agent.name, agent.id)));
      this.models = models;
      this.defaults = defaults;
      this.selectedSettings ||= defaults;
      this.$('model').replaceChildren(...models.map(model => new Option(`${model.name || model.id} · ${model.provider}`, `${model.provider}/${model.id}`)));
      this.renderActivity();
    } catch (error) { this.error(error); }
  }

  optionLabel(value) { return ({ off: 'Off', default: 'Provider default', xhigh: 'Extra high' })[value] || (value ? value[0].toUpperCase() + value.slice(1) : ''); }

  async changeModelSettings(values) {
    if (!this.prepared) { await this.perform('model', values); return; }
    if (this.pending) return;
    this.pending = { action: 'model' };
    this.error();
    this.renderActivity();
    try { this.selectedSettings = await PiBrowser.request('modelDefaults', { settings: values.agentId ? values : { ...this.selectedSettings, ...values } }); }
    catch (error) { this.error(error); }
    finally { this.pending = null; this.renderActivity(); }
  }

  error(error) { this.$('error').textContent = error?.message || ''; }

  async prepare(values, readBody) {
    this.renderSource(values.source);
    this.root.classList.add('new');
    const version = this.version;
    this.loadModels();
    const identifier = await PiBrowser.request('identifier');
    if (version !== this.version) return;
    this.prepared = values;
    this.readBody = readBody;
    this.passage = values.source;
    this.renderImages();
    this.id = `draft:${identifier}`;
    this.$('draft').disabled = false;
    this.renderActivity();
    await this.capabilities();
  }

  async discard() {
    const id = this.id;
    this.dispose();
    if (!this.prepared) return;
    await PiBrowser.request('inputDiscard', { sessionId: id });
  }

  async show(sessionId) {
    this.visible = true;
    this.root.hidden = false;
    if (this.id !== sessionId) {
      if (this.id && (this.hasInput || this.dictationReceipts.has(this.id))) this.inputs.set(this.id, this.input);
      this.id = sessionId;
      this.version++;
      this.session = null;
      this.extensionUI.render(sessionId);
      this.selectedSettings = null;
      this.pending = null;
      PiMessages.update(this.$('messages'), []);
      this.$('messages').textContent = 'Loading conversation…';
      this.setInput(this.inputs.get(sessionId) || { text: '', images: [] });
      this.inputs.delete(sessionId);
      this.$('draft').disabled = false;
      this.error();
    }
    if (this.id !== sessionId) return;
    await Promise.all([this.refresh(), this.capabilities(), this.loadModels()]);
  }

  get hasInput() { return this.hasTextDraft || this.images.length > 0 || Boolean(this.passage) || this.hasDictation; }

  get hasTextDraft() { return Boolean(this.$('draft').value.trim()); }

  get canContinue() { return ['cancelled', 'stopped'].includes(this.session?.status) && !this.hasTextDraft; }

  get canSend() {
    return PiBrowser.available && Boolean(this.session || this.prepared) && !this.session?.busyElsewhere && !this.pending && !this.hasDictation
      && (this.hasTextDraft || this.canContinue);
  }

  get hasImageDraft() { return this.images.length > 0 || Boolean(this.keepImageDraft && this.hasTextDraft); }

  get modelCapabilities() {
    const model = (this.session || this.selectedSettings || this.defaults)?.model;
    return this.models?.find(item => item.provider === model?.provider && item.id === model?.id) || model;
  }

  get hasDictation() { return Boolean(this.id && this.voice.state !== 'idle' && this.voice.sessionId === this.id); }

  resizeDraft(height) {
    this.root.classList.toggle('resized', true);
    this.root.classList.toggle('expanded', height >= 128);
    this.fitDraft();
  }

  fitDraft() {
    const draft = this.$('draft');
    const initial = this.root.classList.contains('new');
    if (initial && this.root.classList.contains('resized')) {
      if (draft.style.height) draft.style.height = '';
      return;
    }
    const width = draft.clientWidth;
    if (!width || draft.hidden) return;
    const composer = this.$('composer');
    const minimum = initial ? composerHeights.initial : composerHeights.followup;
    const surroundingHeight = ['header', 'extension-requests', 'activity', 'queued-inputs', 'keyboard-hints', 'status', 'voice-status', 'voice-recovery', 'error']
      .reduce((height, id) => { const element = this.$(id); const style = getComputedStyle(element);
        return height + (element.offsetHeight ? element.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom) : 0); }, 0);
    const availableHeight = this.root.clientHeight - surroundingHeight - composerHeights.messages - (composer.offsetHeight - draft.offsetHeight) - 8;
    const maximum = initial ? composerHeights.initialLimit : Math.max(minimum, Math.min(composerHeights.followupLimit, availableHeight));
    const key = JSON.stringify([draft.value, width, initial, maximum]);
    if (key === this.draftLayout) return;
    this.draftLayout = key;
    draft.style.height = '0px';
    draft.style.height = `${Math.max(minimum, Math.min(maximum, draft.scrollHeight))}px`;
  }

  focusDraft() { this.$('draft').focus(); }

  hide() { this.visible = false; this.root.hidden = true; }
  dispose() { this.root.dispatchEvent(new Event('pi-conversation-disposed')); this.version++; this.visible = false; this.unsubscribe(); this.unbindQuotes(); this.draftObserver.disconnect(); window.removeEventListener('focus', this.onFocus); }

  invalidate() {
    this.version++; this.id = null; this.session = null; this.prepared = null;
    this.images = []; this.passage = undefined; this.keepImageDraft = false; this.renderImages(); this.hide();
    this.root.dispatchEvent(new Event('pi-conversation-removed'));
  }

  async refresh() {
    const version = this.version;
    const sessionId = this.id;
    if (!sessionId || this.prepared || !this.visible) return;
    // Coalesce updates while Pi is returning a history snapshot.
    if (this.loading === sessionId) { this.reload = true; return; }
    this.loading = sessionId;
    try {
      const session = await PiBrowser.request('detail', { sessionId, cursor: this.session?.cursor ?? null });
      if (version !== this.version) return;
      session.messages = [...(this.session?.messages || []).slice(0, session.messageOffset), ...session.messages];
      this.session = session;
      this.render();
    } catch (error) {
      if (version !== this.version) return;
      if (error.code === 'SESSION_NOT_FOUND') { this.invalidate(); }
      else this.error(error);
    }
    finally {
      if (this.loading === sessionId) this.loading = null;
      if (this.reload) { this.reload = false; this.refresh(); }
    }
  }

  changed(event) {
    if (event.type === 'account-changed') {
      this.catalogGeneration = (this.catalogGeneration || 0) + 1;
      this.models = undefined;
      this.selectedSettings = undefined;
      if (this.visible) this.loadModels();
    }
    if (event.type === 'dictation-level' && event.sessionId === this.id && this.visible && this.voice.state === 'recording') this.renderWaveform(event.level);
    if (['message', 'interaction'].includes(event.type) && (event.change.sessionId === this.id || event.change.sessionIds?.includes(this.id))) this.refresh();
    if (event.type === 'removed') {
      for (const id of event.sessionIds) this.inputs.delete(id);
      if (event.sessionIds.includes(this.id)) { this.invalidate(); return; }
    }
    if (event.type === 'sessions') {
      if (event.change?.deleted && (event.change.sessionId === this.id || event.change.sessionIds?.includes(this.id))) { this.invalidate(); return; }
      if (!event.change || event.change.sessionId === this.id || event.change.executionId === this.session?.sessionId || event.change.sessionIds?.includes(this.id)) this.refresh();
    }
    if (event.type === 'sent') {
      const input = event.sessionId === this.id ? this.input : this.inputs.get(event.sessionId);
      if (input?.text === event.text && JSON.stringify(input.images) === JSON.stringify(event.images || []) && JSON.stringify(input.passage) === JSON.stringify(event.passage)) {
        this.inputs.delete(event.sessionId);
        if (event.sessionId === this.id) this.setInput({ text: '', images: [] });
      }
    }
    if (event.type === 'dictation-result') {
      this.receiveDictation(event.sessionId).catch(error => this.error(error));
    }
    if (event.type === 'dictation') {
      this.voiceVersion++;
      this.voice = event;
      this.renderActivity();
    }
    if (event.type === 'connection') {
      if (event.error) this.error(new Error(event.error));
      else { this.error(); this.capabilities(); this.refresh(); }
      if (event.code === 'EXTENSION_RELOADED') { this.voiceVersion++; this.voice = { state: 'idle' }; }
      this.renderActivity();
    }
  }

  get input() { return { text: this.$('draft').value, images: this.images, passage: this.passage }; }

  setInput(input) {
    this.$('draft').value = input.text;
    this.images = input.images;
    this.passage = input.passage;
    this.keepImageDraft = false;
    this.renderImages();
    this.renderActivity();
  }

  acceptInput(sessionId, input) {
    if (!input || (!input.text && !input.images.length && !input.passage)) return;
    if (sessionId === this.id) this.setInput(input);
    else this.inputs.set(sessionId, input);
  }

  canReceiveDictation(sessionId) {
    const ownsInput = sessionId === this.id ? (this.visible || this.prepared) : this.visible && this.inputs.has(sessionId);
    return sessionId && ownsInput && !this.$('voice').hidden && !(sessionId === this.id && this.pending?.action === 'panel');
  }

  receiveDictation(sessionId) {
    const existing = this.dictationReceipts.get(sessionId);
    if (existing) return existing;
    if (!this.canReceiveDictation(sessionId)) return Promise.resolve();
    const receipt = (async () => {
      // Apply an in-flight side-panel handoff before consuming its recording result.
      if (!this.inline) this.acceptInput(sessionId, await PiBrowser.request('panelInput', { sessionId }));
      if (!this.canReceiveDictation(sessionId)) return;
      const result = await PiBrowser.voice('take', sessionId);
      if (!result || !this.canReceiveDictation(sessionId)) return;
      const input = sessionId === this.id ? this.input : this.inputs.get(sessionId);
      if (!input) return;
      if (this.deliveredDictation.get(sessionId) !== result.recordingId) {
        const next = { ...input, text: input.text + (input.text && result.text ? '\n' : '') + result.text };
        if (sessionId === this.id) this.setInput(next);
        else this.inputs.set(sessionId, next);
        this.deliveredDictation.set(sessionId, result.recordingId);
      }
      await PiBrowser.voice('ack', sessionId, result.recordingId);
      this.deliveredDictation.delete(sessionId);
    })().finally(() => this.dictationReceipts.delete(sessionId));
    this.dictationReceipts.set(sessionId, receipt);
    return receipt;
  }

  async openPanel() {
    const id = this.id;
    const receipt = this.dictationReceipts.get(id);
    if (receipt) await receipt;
    if (this.id !== id || !this.visible) return;
    const input = this.input;
    const opened = await this.perform('panel', { input });
    if (opened) {
      if (this.matchesInput(input)) this.setInput({ text: '', images: [] });
      this.root.dispatchEvent(new Event('pi-conversation-panel'));
    } else await this.receiveDictation(this.id);
  }

  renderImages() {
    this.$('attached-quote').textContent = this.passage?.selection || '';
    this.$('attached-quote').hidden = !this.passage || (this.root.classList.contains('new') && !this.images.length);
    this.$('images').replaceChildren(...this.images.map((image, index) => {
      const box = document.createElement('figure');
      const preview = document.createElement('img');
      preview.src = `data:${image.mimeType};base64,${image.data}`;
      preview.alt = `Attached image ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove image ${index + 1}`);
      remove.addEventListener('click', () => this.setImages(this.images.filter((_, position) => position !== index)).catch(error => this.error(error)));
      box.append(preview, remove);
      return box;
    }));
    this.root.dispatchEvent(new Event('pi-conversation-image-draft'));
  }

  async setImages(images) {
    this.images = images;
    this.renderImages();
    this.renderActivity();
  }

  fork() {
    return this.perform('fork', {}, session => this.root.dispatchEvent(new CustomEvent('pi-conversation-forked', { detail: session })));
  }

  async send(mode) {
    if (!this.canSend) return;
    if (this.session?.status !== 'running' && !this.models) await this.loadModels();
    if (!this.canSend || !this.models) return;
    if (this.session?.status !== 'running' && !this.models.length) {
      if (this.accountConnected) { this.models = undefined; this.error(new Error('This account has no models supported by this build. Check plan access in ChatGPT and try again.')); return; }
      try { await PiBrowser.request('connectAccount'); } catch (error) { this.error(error); }
      return;
    }
    if (this.session?.status === 'running') mode ||= 'steer';
    if (this.images.length && !this.modelCapabilities?.input?.includes('image')) { this.error(new Error('Choose a model that supports images before sending.')); return; }
    const input = this.input;
    const text = input.text.trim() ? input.text : 'Continue from where you stopped.';
    if (this.prepared) {
      this.pending = { action: 'create' };
      this.renderActivity();
      try {
        const text = await this.readBody?.();
        const session = await PiBrowser.request('create', { ...this.prepared, text, ...this.selectedSettings });
        this.id = session.id;
        this.session = session;
        this.prepared = null;
        this.root.dispatchEvent(new CustomEvent('pi-conversation-created', { detail: session }));
      } catch (error) {
        this.error(error);
        this.root.dispatchEvent(new Event('pi-conversation-create-failed'));
        return;
      }
      finally { this.pending = null; this.renderActivity(); }
    }
    const images = this.images;
    const id = this.id;
    if (await this.perform('send', { text, images, passage: input.passage, mode, inputText: input.text }) && this.id === id && this.matchesInput(input)) this.setInput({ text: '', images: [] });
  }

  matchesInput(input) {
    return this.$('draft').value === input.text && this.images === input.images && this.passage === input.passage;
  }

  async perform(action, values = {}, onSuccess) {
    if (this.pending && !(action === 'stop' && this.pending.action === 'send')) return false;
    const id = this.id;
    const operation = { id, action };
    this.pending = operation;
    this.error();
    this.renderActivity();
    try {
      const result = await PiBrowser.request(action, { sessionId: id, ...values });
      if (this.id === id) {
        onSuccess?.(result);
        if (!['edit', 'fork', 'locate', 'panel'].includes(action)) await this.refresh();
      }
      return true;
    } catch (error) { if (this.id === id) this.error(error); return false; }
    finally { if (this.pending === operation) { this.pending = null; this.renderActivity(); } }
  }

  async record(action) {
    const id = this.id;
    if (action === 'start') {
      this.voiceVersion++;
      this.voice = { state: 'preparing', sessionId: this.id };
      this.renderActivity();
    }
    try {
      const voice = await PiBrowser.voice(action, id);
      if (voice.state === 'idle') await this.receiveDictation(id);
      if (this.id === id) { this.voice = voice; this.renderActivity(); }
    }
    catch (error) { this.error(error); this.capabilities(); }
  }

  renderWaveform(level) {
    this.voiceLevels.shift();
    this.voiceLevels.push(level);
    const path = this.voiceLevels.map((value, index) => {
      const height = 2 + value * 22;
      return `M${index * 6 + 3} ${14 - height / 2}v${height}`;
    }).join('');
    this.$('voice-waveform').querySelector('path').setAttribute('d', path);
  }

  render() {
    const session = this.session;
    this.extensionUI.render(this.id, session.interactionRequests);
    this.root.classList.toggle('new', this.inline && session.status === 'idle' && !session.messages?.some(message => message.role === 'user'));
    this.title.textContent = session.title;
    this.renderSource(session.source);
    const list = this.$('messages');
    const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    PiMessages.update(list, session.messages || [], { showContext: false });
    if (!list.childElementCount && !session.interactionRequests?.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'This passage is ready. Write a question or record a draft to begin.'; list.append(empty); }
    if (atEnd) list.scrollTop = list.scrollHeight;
    this.renderActivity();
  }

  renderSource(source) {
    this.$('header').hidden = this.inline;
    this.shadow.querySelector('.heading').hidden = this.inline || this.title !== this.$('title');
    this.$('origin').textContent = `${source.title} · ${new URL(source.url).hostname}`;
    this.$('origin').href = source.citationUrl || source.url;
    this.$('quote').textContent = source.selection;
  }

  renderActivity() {
    const available = PiBrowser.available;
    for (const button of this.actions.querySelectorAll('button')) button.disabled = !available || !this.session || Boolean(this.pending);
    const archive = this.actions.querySelector('[data-action="archive"]');
    archive.title = this.session?.archived ? 'Restore' : 'Archive';
    archive.setAttribute('aria-label', archive.title);
    const running = this.session?.status === 'running';
    const fork = this.actions.querySelector('[data-action="fork"]');
    fork.disabled ||= running || this.session?.busyElsewhere || !this.session?.messages?.some(message => message.role === 'user');
    const recording = this.hasDictation;
    const dictating = recording && this.voice.state !== 'error';
    const recovering = recording && this.voice.state === 'error';
    const settings = this.session || this.selectedSettings || this.defaults;
    if (settings?.agentId) this.agentPicker.value = settings.agentId;
    const model = settings?.model;
    if (model && this.models) {
      const capability = this.modelCapabilities;
      this.$('model').value = `${model.provider}/${model.id}`;
      this.$('model-name').textContent = model.name || model.id;
      const summary = [`${model.provider} / ${model.name || model.id}`];
      for (const [field, levels, label] of [['thinking', capability.thinkingLevels || ['off'], 'Reasoning'], ['tier', capability.speedTiers || [], 'Speed']]) {
        const control = this.$(field);
        const options = levels.join(',');
        if (control.dataset.options !== options) {
          control.replaceChildren(...levels.map(value => new Option(this.optionLabel(value), value)));
          control.dataset.options = options;
        }
        control.value = settings[field];
        const supported = field === 'thinking' ? levels.some(value => value !== 'off') : levels.length > 0;
        this.$(`${field}-control`).hidden = !supported;
        const indicator = this.$(`${field}-name`);
        indicator.hidden = !supported;
        indicator.title = `${label}: ${this.optionLabel(settings[field])}`;
        if (supported) summary.push(indicator.title);
        control.title = label;
      }
      const depth = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].indexOf(settings.thinking);
      this.$('thinking-name').querySelectorAll('rect').forEach((bar, index) => bar.classList.toggle('active', index < depth));
      this.$('tier-name').dataset.fast = String(settings.tier === 'fast');
      this.$('model-summary').title = summary.join(' · ');
      this.$('model-summary').setAttribute('aria-label', `Model settings: ${summary.join(' · ')}`);
    }
    for (const button of this.$('images').querySelectorAll('button')) button.disabled = Boolean(this.pending);
    this.$('add-image').disabled = !available || !this.id || Boolean(this.pending) || running || recording;
    const disabled = !available || !this.models?.length || Boolean(this.pending) || running || this.session?.busyElsewhere || recording;
    for (const field of ['model', 'thinking', 'tier']) this.$(field).disabled = disabled;
    this.$('model-settings').dataset.disabled = String(disabled);
    this.$('model-summary').disabled = disabled;
    if (running || recording) this.$('model-options').hidePopover();
    else if (this.$('model-options').matches(':popover-open')) this.positionModelOptions();
    const composer = this.$('composer');
    if (composer.dataset.dictating !== String(dictating)) {
      composer.dataset.dictating = String(dictating);
      this.voiceLevels.fill(0);
      this.renderWaveform(0);
    }
    this.$('draft').hidden = dictating;
    this.$('draft').readOnly = dictating;
    this.$('model-settings').hidden = dictating;
    this.$('voice-waveform').hidden = !dictating;
    this.$('send').hidden = recording;
    const action = running || this.pending?.action === 'send' ? 'stop' : this.accountConnected === false ? 'connect' : this.canContinue ? 'continue' : 'send';
    const submit = this.$('send');
    const label = { connect: 'Connect ChatGPT to send', send: 'Send', stop: 'Stop task', continue: 'Continue' }[action];
    submit.setAttribute('aria-label', label);
    submit.title = label;
    if (submit.dataset.action !== action) {
      submit.dataset.action = action;
      if (action === 'connect') submit.textContent = 'Connect';
      else submit.innerHTML = composerIcons[action];
    }
    submit.disabled = !available || this.session?.busyElsewhere || (action === 'stop'
      ? Boolean(this.pending && this.pending.action !== 'send')
      : !this.canSend);
    const waiting = Boolean(this.session?.interactionRequests?.length);
    this.$('activity').hidden = !running && !this.session?.busyElsewhere;
    this.$('activity-spinner').hidden = waiting || this.session?.busyElsewhere;
    const activity = this.session?.busyElsewhere ? 'Another discussion on this document is running' : waiting ? 'Waiting for your answer…' : this.pending?.action === 'stop' ? 'Stopping…' : 'Working';
    if (this.$('activity-label').textContent !== activity) this.$('activity-label').textContent = activity;
    this.renderQueuedInputs();
    this.$('keyboard-hints').hidden = this.root.classList.contains('new') || recording;
    const hint = running ? 'steer' : this.canContinue ? 'continue' : 'send';
    if (this.$('submit-hint').textContent !== hint) this.$('submit-hint').textContent = hint;
    this.$('queue-hint').hidden = !running;
    this.$('status').textContent = this.pending ? ({ create: 'Starting conversation…', fork: 'Forking conversation…', send: running ? '' : 'Sending…', stop: '' }[this.pending.action]) : this.session?.error || this.session?.extensionError?.error || (this.session?.status === 'cancelled' ? 'Task stopped.' : '');
    const stoppingRecording = recording && this.voice.state === 'recording';
    this.$('voice').setAttribute('aria-label', stoppingRecording ? 'Stop recording' : 'Record');
    this.$('voice').title = stoppingRecording ? 'Stop recording' : 'Record';
    if (this.$('voice').dataset.recording !== String(stoppingRecording)) {
      this.$('voice').dataset.recording = String(stoppingRecording);
      this.$('voice').innerHTML = stoppingRecording ? voiceIcons.stop : voiceIcons.record;
    }
    this.$('voice').disabled = !available || (this.voice.state === 'idle' ? this.pending?.action === 'create' || !this.voiceReadiness?.ready : !(recording && this.voice.state === 'recording'));
    this.$('cancel-voice').hidden = !recording;
    this.$('voice-recovery').hidden = !recovering;
    this.$('retry-voice').disabled = Boolean(this.pending);
    if (!recovering && this.$('voice-audio').hasAttribute('src')) { this.$('voice-audio').pause(); this.$('voice-audio').removeAttribute('src'); this.$('voice-audio').load(); this.$('voice-audio').hidden = true; }
    const duration = Math.floor(this.voice.duration || 0);
    const elapsed = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
    if (this.previousDictation !== this.hasDictation) {
      this.previousDictation = this.hasDictation;
      this.root.dispatchEvent(new Event('pi-conversation-dictation'));
    }
    this.$('voice-status').textContent = recording ? ({
      preparing: 'Checking voice setup…', permission: 'Allow microphone access in the extension tab.', requesting: 'Waiting for microphone access…',
      recording: `Recording ${elapsed}`,
      transcribing: 'Transcribing into this draft…', delivering: 'Adding text to your draft…',
      error: `Recording kept. ${this.voice.error || 'Retry to add it to your draft.'}`,
    }[this.voice.state] || '') : this.voice.sessionId === this.id && this.voice.error ? this.voice.error : '';
    this.fitDraft();

  }

  renderQueuedInputs() {
    const queue = this.$('queued-inputs');
    const messages = this.session?.queuedMessages || { steer: [], followUp: [] };
    const value = JSON.stringify(messages);
    if (queue.dataset.messages === value) return;
    queue.dataset.messages = value;
    queue.replaceChildren(...Object.entries(messages).flatMap(([mode, texts]) => texts.map(text => {
      const item = document.createElement('div'); item.className = 'queued-input';
      const label = document.createElement('span'); label.className = 'queued-label';
      label.textContent = mode === 'steer' ? 'Pending · current turn' : 'Queued · next turn';
      const content = document.createElement('p'); content.className = 'queued-text'; content.textContent = text; content.title = text;
      item.append(label, content);
      return item;
    })));
    queue.hidden = !queue.childElementCount;
  }
}
