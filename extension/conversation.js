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
  locateIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4M7 10h10M7 14h7"/></svg>',
  archiveIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8v12h14V8M3 4h18v4H3zM9 12h6"/></svg>',
  restoreIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v8h16v-8M3 9v3h5m8 0h5V9M12 15V3m-4 4 4-4 4 4"/></svg>',
  forkIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v12a5 5 0 0 0 5 5h5M7 8h5a5 5 0 0 0 5-5"/></svg>',
  buttons({ compactHints = false } = {}) {
    return [
      ['locate', 'Locate', 'Locate passage', this.locateIcon],
      ['fork', 'Fork', 'Fork conversation', this.forkIcon],
      ['archive', 'Archive', 'Archive', this.archiveIcon],
    ].map(([action, hint, label, icon]) => {
      const tooltip = compactHints ? `data-hint="${hint}"` : `title="${label}"`;
      return `<button data-action="${action}" type="button" aria-label="${label}" ${tooltip}>${icon}</button>`;
    }).join('');
  },
  get panelButton() {
    return '<button data-action="panel" type="button" aria-label="Open in side panel" title="Open in side panel"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 12h6m-3-3 3 3-3 3"/></svg></button>';
  },
  styles: '.discussion-actions{display:flex;gap:2px;flex:none;padding-right:6px}.discussion-actions button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px;border:0;border-radius:6px;background:transparent;color:#526c43}.discussion-actions button:hover{background:#eaf1e1}.discussion-actions button:disabled{opacity:.5;cursor:default}.discussion-actions button:focus-visible{outline:2px solid #88a86b;outline-offset:-2px}.discussion-actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
};

const composerHeights = { initial: 32, initialLimit: 110, followup: 42, followupLimit: 220, messages: 70 };

class PiConversation {
  constructor(root, { inline = false, actions, onRender, captureImages = false } = {}) {
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
        :host{display:flex;flex-direction:column;min-height:0;flex:1;font:var(--margin-reading-size,13px)/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#2d4435}
        *{box-sizing:border-box}[hidden]{display:none!important}button,textarea,input{font:inherit}button{cursor:pointer;border:1px solid #d9e2d3;background:#f3f7ec;color:#426344;border-radius:7px;padding:6px 10px}button:disabled{opacity:.5;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid #6b8f60;outline-offset:2px}
        blockquote{margin:10px 0;padding-left:10px;border-left:2px solid #bfceb1;font-size:var(--margin-detail-size,12px);color:#6b7c60;max-height:85px;overflow:auto}
        #messages{flex:1;min-height:${composerHeights.messages}px;overflow:auto;overscroll-behavior:contain;padding:10px 0}.message{padding:10px 0;border-bottom:1px solid #e7ebdf;overflow-wrap:anywhere}.speaker{font-size:var(--margin-detail-size,10px);color:#7f9073;display:block;margin-bottom:4px}.message-body:not(.markdown){white-space:pre-wrap;margin:0}.empty{color:#829077;font-size:var(--margin-detail-size,12px)}summary{cursor:pointer}
        textarea:focus-visible{outline:0}form:focus-within{border-color:#7d9c68}#model-settings{position:relative;min-width:0;max-width:180px;flex:0 1 auto;font-size:var(--margin-detail-size,11px);color:#6b7c60}#model-summary{border:0;background:transparent;color:inherit;font:inherit;text-align:left;width:100%;display:flex;align-items:center;gap:4px;min-width:0;list-style:none;padding:4px 2px;cursor:pointer}.model-name{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.model-option{display:flex;align-items:center;flex:none;width:14px;height:14px}.model-option svg{width:100%;height:100%;fill:currentColor}.reasoning-bars rect{opacity:.2}.reasoning-bars rect.active{opacity:1}#tier-name{opacity:.3}#tier-name[data-fast="true"]{color:#698b34;opacity:1}#model-settings[data-disabled="true"] #model-summary{opacity:.6;cursor:default}
        form{container-type:inline-size;flex-shrink:0;border:1px solid #d9e2d3;border-radius:10px;background:#f1f5eb;padding:8px;margin-top:8px}textarea{width:100%;display:block;min-height:${composerHeights.followup}px;max-height:${composerHeights.followupLimit}px;resize:none;border:0;background:transparent;color:#2d4435;line-height:1.6;padding:2px}.actions{display:flex;min-width:0;gap:6px;align-items:center;justify-content:flex-end;margin-top:7px}#send{background:#365d3e;border-color:#365d3e;color:#fff}#voice-recovery{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}#voice-recovery audio{width:100%;height:32px}#voice{font-size:var(--margin-detail-size,11px)}#cancel-voice{font-size:var(--margin-detail-size,11px)}.status{font-size:var(--margin-detail-size,11px);color:#76866a;min-height:18px;margin:6px 0 0}#error{color:#a04c36;white-space:pre-wrap}.status:empty{display:none}
        ${marginBrand.styles}
        #draft-pi{display:none}#send,#voice{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;flex:none}#send[data-action="connect"]{width:auto;padding:3px 8px;font-size:var(--margin-detail-size,11px)}#send svg,#voice svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#voice[data-recording="true"] svg,#send[data-action="stop"] svg,#send[data-action="continue"] svg{fill:currentColor;stroke:none}
        #cancel-voice{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;border:0;background:transparent;flex:none}#cancel-voice svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
        #recording-status{font-size:var(--margin-detail-size,11px);color:#63765a;overflow-wrap:anywhere}
        #voice-waveform{min-width:0;height:28px;color:#526c43}
        #voice-waveform svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
        #composer[data-dictating="true"] .actions{display:grid;grid-template-columns:auto fit-content(55%) minmax(0,1fr) auto;width:100%;margin:0}
        #composer[data-dictating="true"] #draft-pi{display:none!important}
        /* Keep space for the draft, mark and gaps before truncating long model names. */
        :host(.new){flex:none}:host(.new) #messages{display:none}:host(.new) .actions{max-width:100%}:host(.new) #composer{display:flex;align-items:center;gap:8px;margin:0;padding:8px 10px;border:0;background:transparent;flex-wrap:wrap}:host(.new) #draft-pi{display:block;font:20px Georgia,serif;color:#638650}:host(.new) textarea{flex:1;min-width:80px;min-height:${composerHeights.initial}px;height:${composerHeights.initial}px;max-height:${composerHeights.initialLimit}px;resize:none}:host(.new) textarea:focus-visible{outline:0}:host(.new) .actions{margin:0;flex:0 1 auto;max-width:calc(100% - 116px)}
        :host(.new) #composer[data-dictating="true"]{display:grid;align-content:start;min-height:min-content}
        :host(.new) #composer[data-dictating="true"] .actions{max-width:none}
        :host(.new) .status{margin:0 10px 5px}
        :host(.new.resized){flex:1;min-height:0}:host(.new.resized) #composer{flex:1;min-height:0}:host(.new.resized) textarea{align-self:stretch;height:auto;max-height:none}
        :host(.new.expanded) #composer{flex-direction:column;align-items:stretch;flex-wrap:nowrap}:host(.new.expanded) #draft-pi{display:none}:host(.new.expanded) textarea{min-width:0;flex-basis:auto}:host(.new.expanded) .actions{flex:none;width:100%;max-width:none;justify-content:flex-end}:host(.new.expanded) #attached-quote,:host(.new.expanded) #images{flex:none}
        #attached-quote{flex-basis:100%;width:100%;margin:0;max-height:65px;overflow:auto}
        :host(.new) #attached-quote{display:none}
        #images{flex-basis:100%;min-width:0;font-size:var(--margin-detail-size,12px);color:#526c43}
        #images summary{width:fit-content;cursor:pointer}
        #image-previews{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
        #images figure{margin:0;position:relative}
        #images img{display:block;max-width:110px;height:72px;object-fit:contain;border:1px solid #cbd8c0;border-radius:6px}
        #images button{position:absolute;right:0;top:0;padding:0;width:20px;height:20px;border-radius:4px;background:#fffef8}
        #add-image{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;flex:none}#add-image svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}
        #activity{display:flex;align-items:center;gap:7px;flex:none;min-height:20px;margin:6px 0;color:#6b805c;font-size:var(--margin-detail-size,11px)}#activity-spinner{width:11px;height:11px;border:1.5px solid #d9e2d3;border-top-color:currentColor;border-right-color:currentColor;border-radius:50%;animation:working 1.3s linear infinite}@keyframes working{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#activity-spinner{animation:none}}
        #queued-inputs{flex:none;max-height:96px;overflow:auto;overscroll-behavior:contain;margin-top:8px}.queued-input{border-radius:8px;background:#f1f5eb;padding:8px 10px}.queued-input+.queued-input{margin-top:5px}.queued-label{display:block;font-size:var(--margin-detail-size,11px);color:#76866a}.queued-text{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:var(--margin-detail-size,12px)}
        #keyboard-hints{display:flex;flex:none;flex-wrap:wrap;justify-content:center;gap:4px 12px;margin:5px 0 0;font-size:var(--margin-detail-size,11px);color:#76866a}kbd{font:inherit;color:#526c43}:host(:not(.new)) #model-settings{margin-right:auto}
        @container (max-width:330px){:host(.new) textarea{flex-basis:calc(100% - 32px);min-width:0}:host(.new) .actions{flex-basis:100%;max-width:100%}}
        ${inline ? ':host(.new) .actions{padding-right:12px}' : ''}
        .model-options {
          position:fixed; inset:auto; margin:0; padding:12px;
          width:max-content; max-width:min(260px,calc(100vw - 16px)); max-height:calc(100dvh - 16px);
          overflow:auto; overscroll-behavior:contain; border:1px solid #c9d7bf;
          border-radius:9px; background:#f8fbf4; box-shadow:0 4px 18px #233a2520;
        }
        .model-options:popover-open { display:grid; gap:8px; }
        #agent-control, #thinking-control { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:10px; }
        .model-options select { min-width:0; width:100%; font:inherit; color:#36523b; background:white; border:1px solid #d9e2d3; border-radius:5px; padding:5px; }
        #model-control { width:210px; max-width:100%; min-width:0; }
        #model-picker { margin-top:3px; }
        #tier { vertical-align:middle; margin:0 5px 0 0; accent-color:#365d3e; }
      </style>
      <div id="extension-requests" aria-live="polite"></div><div id="messages" aria-live="polite"></div>
      <div id="activity" role="status" hidden><span id="activity-spinner" aria-hidden="true"></span><span id="activity-label">Working</span></div>
      <div id="queued-inputs" aria-label="Pending messages" aria-live="polite" hidden></div>
      <form id="composer"><blockquote id="attached-quote" hidden></blockquote><details id="images" hidden><summary id="image-count"></summary><div id="image-previews"></div></details><span id="draft-pi" aria-hidden="true">${marginBrand.icon}</span><textarea id="draft" rows="1" aria-label="Discussion draft" placeholder="Ask about this passage…" disabled></textarea><div class="actions"><button id="cancel-voice" type="button" aria-label="Cancel dictation" title="Cancel dictation" hidden>${voiceIcons.cancel}</button><span id="recording-status" role="status" hidden></span><div id="voice-waveform" role="img" aria-label="Microphone activity" hidden><svg viewBox="0 0 192 28" preserveAspectRatio="none" aria-hidden="true"><path/></svg></div><div id="model-settings"><button id="model-summary" type="button" popovertarget="model-options" aria-label="Model settings"><span class="model-name" id="model-name">Model</span><span class="model-option reasoning-bars" id="thinking-name" aria-hidden="true" hidden><svg viewBox="0 0 15 14"><rect x="0" y="10" width="2" height="4"/><rect x="3" y="8" width="2" height="6"/><rect x="6" y="6" width="2" height="8"/><rect x="9" y="3" width="2" height="11"/><rect x="12" y="0" width="2" height="14"/></svg></span><span class="model-option" id="tier-name" aria-hidden="true" hidden><svg viewBox="0 0 16 16"><path d="M9 0 2 9h5l-1 7 8-10H9z"/></svg></span></button><div id="model-options" class="model-options" popover><label id="agent-control" hidden>Agent<select id="agent"></select></label><div id="model-control" hidden>Model<div id="model-picker"></div></div><label id="thinking-control">Reasoning<select id="thinking" aria-label="Reasoning level" disabled></select></label><label id="tier-control"><input type="checkbox" id="tier" disabled> Fast mode</label></div></div><button id="add-image" type="button" aria-label="Add image" title="Add image" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 4-5 4 5"/></svg></button><button id="voice" type="button" aria-label="Record" title="Record" hidden>${voiceIcons.record}</button><button id="send" type="button" aria-label="Send" title="Send" disabled>${composerIcons.send}</button></div></form>
      <div id="keyboard-hints" hidden><span><kbd>Enter</kbd> <span id="submit-hint">send</span></span><span id="queue-hint" hidden><kbd>Tab</kbd> queue</span><span><kbd>Shift + Enter</kbd> new line</span></div>
      <p id="status" class="status" role="status"></p><p id="voice-status" class="status" role="status"></p><div id="voice-recovery" hidden><button id="retry-voice" type="button">Retry</button><button id="listen-voice" type="button">Listen</button><audio id="voice-audio" controls hidden></audio></div><p id="error" class="status" role="alert"></p>`;
    this.$ = id => this.shadow.getElementById(id);
    this.captureImages = captureImages;
    this.$('add-image').hidden = !captureImages;
    this.$('images').addEventListener('toggle', () => this.renderImagePreviews());
    this.$('add-image').addEventListener('click', () => this.root.dispatchEvent(new Event('pi-conversation-images')));
    this.onRender = onRender;
    this.actions = actions;
    this.actions.addEventListener('click', event => {
      if (!this.session || this.pending) return;
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'locate') this.perform('locate');
      if (action === 'archive') this.perform('edit', { archived: !this.session.archived });
      if (action === 'fork') this.fork();
      if (action === 'panel') this.openPanel();
    });
    this.modelPicker = new MarginModelPicker(this.$('model-picker'), 'Model', id => {
      this.changeModelSettings({ model: this.models.find(model => model.id === id) });
    });
    this.$('model-options').addEventListener('click', () => {
      if (this.$('model-options').matches(':popover-open')) this.positionModelOptions();
    });
    this.$('agent').addEventListener('change', () => this.changeModelSettings({ agentId: this.$('agent').value }));
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
    this.$('thinking').onchange = () => this.changeModelSettings({ thinking: this.$('thinking').value });
    this.$('tier').onchange = () => this.changeModelSettings({ tier: this.$('tier').checked ? 'fast' : 'default' });
    this.extensionUI = new PiExtensionUI(this.$('extension-requests'), async (sessionId, requestId, answer) => {
      try { return await PiBrowser.request('interaction', { sessionId, requestId, answer }); }
      finally { if (this.id === sessionId) await this.refresh(); }
    });
    this.onFocus = () => { if (this.visible && !this.$('voice').hidden && !this.voiceReadiness?.ready) this.capabilities(); };
    window.addEventListener('focus', this.onFocus);
    this.onVisibilityChange = () => {
      if (document.hidden) clearTimeout(this.refreshTimer);
      else if (this.visible && this.taskActive && PiBrowser.available) this.refresh();
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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

  applyModelOptions({ models, defaults, agents, connected }) {
    this.models = models;
    this.defaults = defaults;
    this.agents = agents;
    this.accountConnected = connected;
    this.$('agent-control').hidden = agents.length < 2;
    this.$('agent').replaceChildren(...agents.map(agent => new Option(agent.name, agent.id)));
    this.modelPicker.setOptions(models);
    // Replace catalog metadata without changing the model the reader chose.
    if (this.selectedSettings?.model) {
      const updated = models.find(model => model.id === this.selectedSettings.model.id);
      if (updated) this.selectedSettings = { ...this.selectedSettings, model: updated };
    } else if (connected && defaults?.model) this.selectedSettings = defaults;
    this.renderActivity();
  }

  async previewModels() {
    if (this.models) return;
    const generation = this.catalogGeneration;
    const options = await PiBrowser.request('modelPreview');
    if (generation === this.catalogGeneration && !this.modelsConfirmed) this.applyModelOptions(options);
  }

  loadModels(reopen = false) {
    if (this.modelsConfirmed && !reopen) return;
    if (this.modelRequest) return this.modelRequest;
    const generation = this.catalogGeneration;
    const request = PiBrowser.request('models').then(options => {
      if (generation !== this.catalogGeneration) return;
      this.modelsConfirmed = true;
      this.applyModelOptions(options);
    }).catch(error => {
      if (generation === this.catalogGeneration) this.error(error);
    }).finally(() => { if (this.modelRequest === request) this.modelRequest = null; });
    this.modelRequest = request;
    return request;
  }

  changeModelSettings(values) {
    if (!this.prepared) return this.perform('model', values);
    const settings = values.agentId ? this.agents.find(agent => agent.id === values.agentId).defaults
      : { ...(this.selectedSettings || this.defaults), ...values };
    this.selectedSettings = MarginModelPreferences.normalize(settings);
    this.error();
    this.$('model-options').hidePopover();
    this.renderActivity();
  }

  error(error) {
    this.$('error').textContent = error?.message || '';
    if (error?.code === 'MODEL_UNAVAILABLE') {
      this.modelsConfirmed = false;
      this.loadModels();
    }
  }

  async prepare(values, readBody) {
    this.root.classList.add('new');
    const version = this.version;
    this.loadModels();
    const [identifier] = await Promise.all([PiBrowser.request('identifier'), this.previewModels()]);
    if (version !== this.version) return;
    this.prepared = values;
    this.readBody = readBody;
    this.setPassage(values.source);
    this.id = `draft:${identifier}`;
    this.$('draft').disabled = false;
    this.renderActivity();
    this.capabilities();
  }

  async discard() {
    const id = this.id;
    this.dispose();
    if (!this.prepared) return;
    await PiBrowser.request('inputDiscard', { sessionId: id });
  }

  async show(sessionId) {
    const reopen = !this.visible || this.id !== sessionId;
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
      this.setInput(this.inputs.get(sessionId));
      this.inputs.delete(sessionId);
      this.$('draft').disabled = false;
      this.error();
    }
    if (this.id !== sessionId) return;
    this.capabilities();
    this.previewModels().catch(error => this.error(error));
    this.loadModels(reopen);
    await this.refresh();
  }

  get hasInput() { return Boolean(this.$('draft').value) || this.images.length > 0 || Boolean(this.passage) || this.hasDictation; }

  get hasTextDraft() { return Boolean(this.$('draft').value.trim()); }

  get taskActive() { return this.session?.status === 'running' || Boolean(this.session?.busyElsewhere); }

  get canContinue() { return ['cancelled', 'stopped'].includes(this.session?.status) && !this.hasTextDraft; }

  get unavailableModel() {
    const model = (this.session || this.selectedSettings)?.model;
    return this.modelsConfirmed && this.accountConnected && model && !this.models.some(item => item.id === model.id) ? model : null;
  }

  get canSend() {
    return PiBrowser.available && Boolean(this.session || this.prepared) && !this.session?.busyElsewhere && !this.pending && !this.hasDictation && !this.unavailableModel
      && (this.hasTextDraft || this.canContinue);
  }

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
    const minimum = initial ? composerHeights.initial : composerHeights.followup;
    let maximum = composerHeights.initialLimit;
    if (!initial) {
      const surroundingHeight = ['extension-requests', 'activity', 'queued-inputs', 'keyboard-hints', 'status', 'voice-status', 'voice-recovery', 'error']
        .reduce((height, id) => {
          const element = this.$(id);
          if (!element.offsetHeight) return height;
          const style = getComputedStyle(element);
          return height + element.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        }, 0);
      const composerSpace = this.$('composer').offsetHeight - draft.offsetHeight;
      const available = this.root.clientHeight - surroundingHeight - composerHeights.messages - composerSpace - 8;
      maximum = Math.max(minimum, Math.min(composerHeights.followupLimit, available));
    }
    const key = JSON.stringify([draft.value, width, initial, maximum]);
    if (key === this.draftLayout) return;
    this.draftLayout = key;
    draft.style.height = '0px';
    draft.style.height = `${Math.max(minimum, Math.min(maximum, draft.scrollHeight))}px`;
  }

  focusDraft() { this.$('draft').focus(); }

  hide() {
    clearTimeout(this.refreshTimer);
    this.visible = false;
    this.root.hidden = true;
  }
  dispose() {
    this.root.dispatchEvent(new Event('pi-conversation-disposed'));
    this.version++;
    this.hide();
    this.id = null;
    this.inputs.clear();
    this.unsubscribe();
    this.unbindQuotes();
    this.draftObserver.disconnect();
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  invalidate() {
    this.version++; this.id = null; this.session = null; this.prepared = null;
    this.setInput(); this.hide();
    this.root.dispatchEvent(new Event('pi-conversation-removed'));
  }

  async refresh() {
    const version = this.version;
    const sessionId = this.id;
    clearTimeout(this.refreshTimer);
    if (!sessionId || this.prepared || !this.visible) return;
    if (this.loadingVersion === version) { this.reload = true; return; }
    this.loadingVersion = version;
    this.reload = false;
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
      if (this.version === version) {
        this.loadingVersion = null;
        if (this.reload) this.refresh();
        else if (this.visible && !document.hidden && PiBrowser.available && this.taskActive) {
          // A missed task event must not leave an open discussion showing stale progress.
          this.refreshTimer = setTimeout(() => this.refresh(), 2000);
        }
      }
    }
  }

  changed(event) {
    if (event.type === 'account-changed') {
      this.catalogGeneration = (this.catalogGeneration || 0) + 1;
      this.models = this.modelRequest = this.defaults = undefined;
      this.modelPicker.setOptions([]);
      this.$('agent-control').hidden = true;
      this.modelsConfirmed = false;
      this.accountConnected = undefined;
      this.renderActivity();
      if (this.visible) {
        this.previewModels().catch(error => this.error(error));
        this.loadModels();
      }
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
        if (event.sessionId === this.id) this.setInput();
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

  setInput(input = { text: '', images: [] }) {
    this.$('draft').value = input.text;
    this.images = input.images;
    this.setPassage(input.passage);
    this.renderImages();
    this.renderActivity();
    this.root.dispatchEvent(new Event('pi-conversation-input'));
  }

  acceptInput(sessionId, input) {
    if (!input || (!input.text && !input.images.length && !input.passage)) return;
    if (sessionId === this.id) this.setInput(input);
    else this.inputs.set(sessionId, input);
  }

  canReceiveDictation(sessionId) {
    // The side panel still owns its drafts while the reader browses the list.
    const acceptsInput = this.visible || !this.inline;
    const ownsInput = sessionId === this.id ? (acceptsInput || this.prepared) : acceptsInput && this.inputs.has(sessionId);
    return sessionId && ownsInput && !this.$('voice').hidden && !(sessionId === this.id && this.pending?.action === 'panel');
  }

  receiveDictation(sessionId) {
    const existing = this.dictationReceipts.get(sessionId);
    if (existing) return existing;
    if (!this.canReceiveDictation(sessionId)) return Promise.resolve();
    const receipt = (async () => {
      // Apply an in-flight side-panel handoff before consuming its recording result.
      if (!this.inline) {
        const input = await PiBrowser.request('panelInput', { sessionId });
        if (!this.canReceiveDictation(sessionId)) return;
        this.acceptInput(sessionId, input);
      }
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
      if (this.matchesInput(input)) this.setInput();
      this.root.dispatchEvent(new Event('pi-conversation-panel'));
    } else await this.receiveDictation(this.id);
  }

  setPassage(passage) {
    this.passage = passage;
    this.$('attached-quote').textContent = passage?.selection || '';
    this.$('attached-quote').hidden = !passage;
  }

  renderImages() {
    const count = this.images.length;
    const details = this.$('images');
    details.hidden = !count;
    if (!count) details.open = false;
    this.$('image-count').textContent = count === 1 ? '1 image attached' : `${count} images attached`;
    this.renderImagePreviews();
  }

  renderImagePreviews() {
    const images = this.$('images').open ? this.images : [];
    this.$('image-previews').replaceChildren(...images.map((image, index) => {
      const box = document.createElement('figure');
      const preview = document.createElement('img');
      preview.src = `data:${image.mimeType};base64,${image.data}`;
      preview.alt = `Attached image ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.disabled = Boolean(this.pending);
      remove.setAttribute('aria-label', `Remove image ${index + 1}`);
      remove.addEventListener('click', () => this.setImages(this.images.filter((_, position) => position !== index)));
      box.append(preview, remove);
      return box;
    }));
  }

  setImages(images) {
    this.images = images;
    this.renderImages();
    this.renderActivity();
  }

  fork() {
    return this.perform('fork', {}, session => this.root.dispatchEvent(new CustomEvent('pi-conversation-forked', { detail: session })));
  }

  async send(mode) {
    if (!this.canSend) return;
    const input = this.input;
    if (!this.modelsConfirmed && !this.models?.length) {
      const version = this.version;
      await this.loadModels();
      if (!this.visible || this.version !== version || !this.matchesInput(input) || !this.canSend || !this.modelsConfirmed) return;
    }
    if (this.session?.status !== 'running' && !this.models.length) {
      if (this.accountConnected) { this.modelsConfirmed = false; this.error(new Error('This account has no models supported by this build. Check model access in connection settings and try again.')); return; }
      try { await PiBrowser.request('connectAccount'); } catch (error) { this.error(error); }
      return;
    }
    if (this.session?.status === 'running') mode ||= 'steer';
    if (this.images.length && !this.modelCapabilities?.input?.includes('image')) { this.error(new Error('Choose a model that supports images before sending.')); return; }
    const text = input.text.trim() ? input.text : 'Continue from where you stopped.';
    if (this.prepared) {
      this.pending = { action: 'create' };
      this.renderActivity();
      try {
        const text = await this.readBody?.();
        const session = await PiBrowser.request('create', { ...this.prepared, text, ...(this.selectedSettings || this.defaults) });
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
    if (await this.perform('send', { text, images, passage: input.passage, mode, inputText: input.text }) && this.id === id && this.matchesInput(input)) this.setInput();
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
    this.onRender?.(session);
    const list = this.$('messages');
    const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    PiMessages.update(list, session.messages || [], { showContext: false });
    if (!list.childElementCount && !session.interactionRequests?.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'This passage is ready. Write a question or record a draft to begin.'; list.append(empty); }
    if (atEnd) list.scrollTop = list.scrollHeight;
    this.renderActivity();
  }

  renderActivity() {
    const available = PiBrowser.available;
    for (const button of this.actions.querySelectorAll('button[data-action]')) button.disabled = !available || !this.session || Boolean(this.pending);
    const archive = this.actions.querySelector('[data-action="archive"]');
    if (archive) {
      if (archive.dataset.archived !== String(Boolean(this.session?.archived))) {
        archive.dataset.archived = String(Boolean(this.session?.archived));
        const label = this.session?.archived ? 'Restore' : 'Archive';
        archive.setAttribute('aria-label', label);
        if (archive.hasAttribute('data-hint')) archive.dataset.hint = label;
        else archive.title = label;
        archive.innerHTML = this.session?.archived ? discussionActions.restoreIcon : discussionActions.archiveIcon;
      }
    }
    const running = this.session?.status === 'running';
    const fork = this.actions.querySelector('[data-action="fork"]');
    fork.disabled ||= this.taskActive || !this.session?.messages?.some(message => message.role === 'user');
    const recording = this.hasDictation;
    const dictating = recording && this.voice.state !== 'error';
    const recovering = recording && this.voice.state === 'error';
    const settings = this.session || this.selectedSettings || this.defaults;
    if (settings?.agentId) this.$('agent').value = settings.agentId;
    const model = settings?.model;
    if (model) {
      const capability = this.modelCapabilities;
      this.modelPicker.select(model.id, model.name);
      this.$('model-control').hidden = this.modelPicker.trigger.hidden;
      this.$('model-name').textContent = model.name || model.id;
      const summary = [`${model.provider} / ${model.name || model.id}`];
      for (const [field, levels, label] of [['thinking', capability.thinkingLevels || ['off'], 'Reasoning'], ['tier', capability.speedTiers || [], 'Speed']]) {
        const control = this.$(field);
        const options = levels.join(',');
        if (field === 'tier') control.checked = settings.tier === 'fast';
        else if (control.dataset.options !== options) {
          control.replaceChildren(...levels.map(value => new Option(MarginModelPreferences.label(value), value)));
          control.dataset.options = options;
        }
        if (field === 'thinking') control.value = settings[field];
        const supported = field === 'thinking' ? levels.some(value => value !== 'off') : levels.length > 0;
        this.$(`${field}-control`).hidden = levels.length < 2;
        const indicator = this.$(`${field}-name`);
        indicator.hidden = !supported;
        indicator.title = `${label}: ${MarginModelPreferences.label(settings[field])}`;
        if (supported) summary.push(indicator.title);
        control.title = label;
      }
      const levels = (capability.thinkingLevels || []).filter(level => level !== 'off');
      const bars = this.$('thinking-name').querySelectorAll('rect');
      const depth = levels.length ? Math.ceil((levels.indexOf(settings.thinking) + 1) * bars.length / levels.length) : 0;
      bars.forEach((bar, index) => bar.classList.toggle('active', index < depth));
      this.$('tier-name').dataset.fast = String(settings.tier === 'fast');
      this.$('model-summary').title = summary.join(' · ');
      this.$('model-summary').setAttribute('aria-label', `Model settings: ${summary.join(' · ')}`);
    } else {
      this.$('model-name').textContent = 'Model';
      this.$('model-summary').title = 'Model settings';
      this.$('model-summary').setAttribute('aria-label', 'Model settings');
      this.$('thinking-name').hidden = this.$('tier-name').hidden = true;
    }
    for (const button of this.$('images').querySelectorAll('button')) button.disabled = Boolean(this.pending);
    this.$('add-image').disabled = !available || !this.id || Boolean(this.pending) || running || recording;
    const editable = this.models?.length || (this.prepared && this.accountConnected == null && model);
    const disabled = !available || !editable || Boolean(this.pending) || this.taskActive || recording;
    for (const field of ['agent', 'thinking', 'tier']) this.$(field).disabled = disabled;
    this.modelPicker.trigger.disabled = disabled || !this.models?.length;
    const adjustable = ['agent-control', 'model-control', 'thinking-control', 'tier-control'].some(id => !this.$(id).hidden);
    this.$('model-settings').dataset.disabled = String(disabled);
    this.$('model-summary').disabled = disabled || !adjustable;
    if (disabled || !adjustable) this.$('model-options').hidePopover();
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
    this.$('recording-status').hidden = !dictating;
    this.$('add-image').hidden = !this.captureImages || dictating;
    this.$('send').hidden = recording;
    const action = running || this.pending?.action === 'send' ? 'stop' : this.accountConnected === false ? 'connect' : this.canContinue ? 'continue' : 'send';
    const submit = this.$('send');
    const label = { connect: 'Connect an account to send', send: 'Send', stop: 'Stop task', continue: 'Continue' }[action];
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
    this.$('activity').hidden = !this.taskActive;
    this.$('activity-spinner').hidden = waiting || this.session?.busyElsewhere;
    const activity = this.session?.busyElsewhere ? 'Another discussion on this document is running' : waiting ? 'Waiting for your answer…' : this.pending?.action === 'stop' ? 'Stopping…' : 'Working';
    if (this.$('activity-label').textContent !== activity) this.$('activity-label').textContent = activity;
    this.renderQueuedInputs();
    this.$('keyboard-hints').hidden = this.root.classList.contains('new') || recording;
    const hint = running ? 'steer' : this.canContinue ? 'continue' : 'send';
    if (this.$('submit-hint').textContent !== hint) this.$('submit-hint').textContent = hint;
    this.$('queue-hint').hidden = !running;
    const unavailable = this.unavailableModel;
    const modelNotice = unavailable && (this.models.length
      ? `${unavailable.name || unavailable.id} is no longer available. Choose another model before sending.`
      : 'This account has no available models supported by this build.');
    this.$('status').textContent = modelNotice || (this.pending ? ({ create: 'Starting conversation…', fork: 'Forking conversation…', send: running ? '' : 'Sending…', stop: '' }[this.pending.action]) : this.session?.error || this.session?.extensionError?.error || (this.session?.status === 'cancelled' ? 'Task stopped.' : ''));
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
    this.$('recording-status').textContent = dictating ? ({
      preparing: 'Checking voice setup…', permission: 'Allow microphone access in the extension tab.', requesting: 'Waiting for microphone access…',
      recording: `Recording ${elapsed}`,
      transcribing: 'Transcribing into this draft…', delivering: 'Adding text to your draft…',
    }[this.voice.state] || '') : '';
    this.$('voice-status').textContent = recovering ? `Recording kept. ${this.voice.error || 'Retry to add it to your draft.'}`
      : !dictating && this.voice.sessionId === this.id && this.voice.error ? this.voice.error : '';
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
