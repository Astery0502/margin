class PiSourceDiscussions {
  constructor({ sourceId, createFrame, anchor, readBody, onChange, onSessions, onError, dismissSelection, containsSelection, top = 8 }) {
    this.options = { sourceId, createFrame, anchor, readBody, onChange, onSessions, onError, dismissSelection, containsSelection, top };
    this.records = new Map();
    this.markerOffsets = new Map();
    this.sessions = [];
    this.version = 0;
    this.layoutFrame = null;
    this.imageCapture = new PiImageCapture({
      hide: () => this.setOpen(this.current, false),
      resume: () => this.resumeCapture().catch(error => this.error(error)),
      cancel: () => this.cancelCapture().catch(error => this.error(error)),
    });
    this.resumeHost = document.createElement('div');
    this.resumeHost.setAttribute('data-pi-source-ui', '');
    this.resumeHost.setAttribute('data-pi-discussion-resume', '');
    const shadow = this.resumeHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>:host{all:initial;position:fixed;right:20px;bottom:76px;z-index:2147483646}:host([hidden]){display:none}button{font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:8px 12px;color:#526c43;background:#fffef8;border:1px solid #c9d8bd;border-radius:8px;box-shadow:0 2px 7px #26371618;cursor:pointer}button:focus-visible{outline:2px solid #88a86b;outline-offset:2px}</style><button type="button">Return to question</button>';
    this.resumeHost.hidden = true;
    this.resumeButton = shadow.querySelector('button');
    this.resumeButton.addEventListener('click', () => this.open(this.pending).catch(error => this.error(error)));
    document.body.append(this.resumeHost);
    this.sizeObserver = new ResizeObserver(() => this.layout());
    this.unbindDismissal = bindDiscussionDismissal(event => this.dismiss(event));
    this.unsubscribe = PiBrowser.subscribe(event => {
      if (event.type === 'source-closed' && event.sourceId === this.options.sourceId()) { this.clear(); return; }
      if ((event.type === 'sessions' && (!event.change || event.change.sourceId === this.options.sourceId())) || event.type === 'removed' || (event.type === 'connection' && !event.error)) this.refresh().catch(error => this.error(error));
    });
  }

  error(error) { this.options.onError(error); }

  register(session) {
    if (session.id && this.records.has(session.id)) return this.records.get(session.id);
    const frame = this.options.createFrame(session);
    if (!frame) return null;
    const record = { session, frame, open: false, alive: true, view: null };
    record.window = discussionWindow.bind(frame.section, frame.handle, {
      top: this.options.top, anchor: () => this.options.anchor(record), onResize: height => record.view.resizeDraft(height),
    });
    record.observer = new MutationObserver(() => { this.render(record); this.layout(); });
    record.observer.observe(frame.root, { attributes: true, attributeFilter: ['class'] });
    frame.setOpen(false);
    this.sizeObserver.observe(frame.section);
    frame.section.addEventListener('click', event => {
      if (!event.target.closest('[data-action="panel"]')) this.relate(record);
    });
    frame.root.addEventListener('pi-conversation-dictation', () => this.changed());
    frame.root.addEventListener('pi-conversation-image-draft', () => { this.render(record); this.changed(); });
    frame.root.addEventListener('pi-conversation-removed', () => this.remove(record));
    frame.root.addEventListener('pi-conversation-panel', () => this.close(record));
    frame.root.addEventListener('pi-conversation-forked', event => this.openSession(event.detail).catch(error => this.error(error)));
    frame.root.addEventListener('pi-conversation-images', () => {
      this.options.dismissSelection();
      this.captureRecord = record;
      this.imageCapture.start(record.view);
    });
    frame.root.addEventListener('pi-conversation-created', event => {
      if (!record.alive) return;
      const saved = this.records.get(event.detail.id);
      if (saved && saved !== record) this.remove(saved);
      record.session = event.detail;
      if (this.pending === record) this.pending = null;
      this.records.set(record.session.id, record);
      this.render(record);
      if (record.open) this.relate(record);
      this.changed();
      this.refresh().catch(error => this.error(error));
    });
    frame.root.addEventListener('pi-conversation-create-failed', () => {
      if (!record.session.id && !record.open) this.remove(record);
    });
    if (session.id) this.records.set(session.id, record);
    this.render(record);
    return record;
  }

  render(record) {
    record.frame.section.classList.toggle('new', !record.session.id || Boolean(record.view && record.frame.root.classList.contains('new')));
    record.frame.section.classList.toggle('full', Boolean(record.session.source.includeFullText));
    record.frame.handle.setAttribute('aria-label', `Move ${record.session.source.includeFullText ? 'Full' : 'Quick'} discussion`);
    record.frame.render(record);
  }

  setOpen(record, open) {
    if (!open) record.window.retainPosition();
    record.open = open;
    record.frame.setOpen(open);
    if (!open) { record.openOperation = null; record.view?.hide(); }
    this.render(record);
    this.changed();
  }

  async open(record) {
    if (this.imageCapture.active || !record?.alive) return;
    if (this.current && this.current !== record) this.close(this.current);
    this.current = record;
    const operation = {};
    record.openOperation = operation;
    if (!record.open) record.frame.section.style.visibility = 'hidden';
    if (!record.view) {
      record.frame.root.classList.toggle('new', !record.session.id);
      record.view = new PiConversation(record.frame.root, { inline: true, captureImages: true, actions: record.frame.actions });
    }
    this.setOpen(record, true);
    const ready = record.view.session || record.view.prepared;
    try {
      const showing = record.session.id || record.view.prepared ? record.view.show(record.session.id || record.view.id) : null;
      if (ready) this.present(record);
      await showing;
    } catch (error) {
      if (!record.alive || !record.open || record.openOperation !== operation) return;
      this.close(record);
      throw error;
    }
    if (!record.alive || !record.open || record.openOperation !== operation) return;
    if (!record.session.id && !record.view.prepared) return;
    if (!ready) this.present(record);
  }

  present(record) {
    this.render(record);
    record.window.place();
    record.frame.section.style.visibility = '';
    this.layout();
    record.view.focusDraft();
    this.relate(record);
  }

  async openSession(session) {
    this.opening = null;
    const record = this.register(session);
    if (record) await this.open(record);
  }

  bindMarker(button, session) {
    button.setAttribute('data-pi-discussion-marker', '');
    button.title = `${button.title ? button.title + '\n' : ''}Click to open; drag to move`;
    return bindDiscussionMarker(button, {
      top: this.options.top,
      getOffset: () => this.markerOffsets.get(session().id),
      setOffset: offset => this.markerOffsets.set(session().id, offset),
      open: () => this.openSession(session()).catch(error => this.error(error)),
    });
  }

  async prepare(source, includeFullText) {
    const operation = {};
    this.opening = operation;
    this.changed();
    let record;
    try {
      const prepared = includeFullText ? await PiBrowser.request('prepareDiscussion', { source }) : null;
      const session = prepared?.discussion;
      if (this.opening !== operation) return;
      if (session) {
        record = this.register(session);
        if (!record) throw new Error('The discussion passage no longer matches this document.');
        operation.record = record;
        await this.open(record);
        if (this.opening !== operation || !record.alive || !record.open) return;
        record.view.setInput({ ...record.view.input, passage: source });
      } else if (this.pending && (this.retained(this.pending) || this.pending.view?.pending?.action === 'create')) {
        record = this.pending;
        operation.record = record;
        await this.open(record);
        if (this.opening !== operation || !record.alive || !record.open) return;
      } else {
        if (this.current) this.close(this.current);
        if (this.pending) this.remove(this.pending);
        record = this.register({ source: { ...source, includeFullText }, status: 'idle', title: '' });
        if (!record) throw new Error('Select the passage again to open a discussion.');
        this.pending = record;
        operation.record = record;
        await this.open(record);
        const readBody = includeFullText && !prepared.document ? this.options.readBody : undefined;
        if (this.opening !== operation || !record.alive || !record.open) return;
        await record.view.prepare({ source: record.session.source, includeFullText }, readBody);
        if (this.opening !== operation || !record.alive || !record.open) return;
      }
      window.getSelection().removeAllRanges();
      this.present(record);
    } catch (error) {
      if (this.opening !== operation) return;
      if (record && !record.session.id) this.remove(record);
      throw error;
    } finally {
      if (this.opening === operation) this.opening = null;
      this.changed();
    }
  }

  retained(record) { return Boolean(record.view?.hasDictation || record.view?.hasImageDraft || (record.retained && record.view?.hasTextDraft)); }

  close(record = this.current) {
    if (!record) return;
    if (this.retained(record)) record.retained = true;
    if (record.session.id || this.retained(record) || record.view?.pending?.action === 'create') this.setOpen(record, false);
    else this.remove(record);
    if (this.current === record) this.current = null;
    this.changed();
  }

  remove(record) {
    if (!record.alive) return;
    record.alive = false;
    if (this.current === record) this.current = null;
    if (this.pending === record) this.pending = null;
    if (this.opening?.record === record) this.opening = null;
    record.observer.disconnect();
    this.sizeObserver.unobserve(record.frame.section);
    if (record.session.id) this.records.delete(record.session.id);
    record.frame.remove();
    if (record.view?.prepared) record.view.discard().catch(error => this.error(error));
    else record.view?.dispose();
    this.changed();
  }

  relate(record) {
    if (!record.session.id) return;
    PiBrowser.request('relate', { sessionId: record.session.id }).catch(error => this.error(error));
  }

  dismiss(event) {
    if (this.imageCapture.active) return;
    if (event.type === 'focusout') {
      if (this.current === this.pending && !this.pending?.view?.hasInput) { this.opening = null; this.close(); }
      return;
    }
    const path = event.composedPath();
    if (event.type === 'mousedown' && !this.options.containsSelection(path)) this.options.dismissSelection();
    if (event.key === 'Escape') this.options.dismissSelection();
    const marker = path.some(node => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-pi-discussion-marker'));
    if (event.key === 'Escape' || (this.current && !this.current.frame.contains(path) && !path.includes(this.resumeHost) && !marker)) {
      this.opening = null;
      this.close();
    }
  }

  async resumeCapture() {
    const record = this.captureRecord;
    this.captureRecord = null;
    await this.open(record);
    if (!record.alive || !record.open) return;
    record.window.dock();
    record.view.focusDraft();
  }

  async cancelCapture() {
    const record = this.captureRecord;
    this.captureRecord = null;
    if (!record.session.id) this.remove(record);
    else {
      record.view.setInput({ text: '', images: [] });
      this.close(record);
    }
  }

  async refresh() {
    const sourceId = this.options.sourceId();
    const version = ++this.version;
    const sessions = await PiBrowser.request('list', { sourceId });
    if (version !== this.version) return;
    this.sessions = sessions.filter(session => session.source.id === sourceId && !session.archived);
    const byId = new Map(this.sessions.map(session => [session.id, session]));
    for (const id of this.markerOffsets.keys()) if (!byId.has(id)) this.markerOffsets.delete(id);
    for (const record of this.records.values()) {
      const session = byId.get(record.session.id);
      if (!session) this.remove(record);
      else { record.session = session; this.render(record); }
    }
    this.options.onSessions?.(this.sessions);
    this.changed();
  }

  changed() {
    this.resumeHost.hidden = !this.pending || this.pending.open || this.imageCapture.active || !this.retained(this.pending);
    this.resumeButton.textContent = this.pending?.view?.hasDictation ? 'Return to recording draft' : 'Return to question';
    this.presentationDirty = true;
    this.layout();
  }

  layout() {
    if (this.layoutFrame !== null) return;
    this.layoutFrame = requestAnimationFrame(() => {
      if (this.presentationDirty) { this.presentationDirty = false; this.options.onChange(); }
      if (this.current?.open) this.current.window.place();
      this.layoutFrame = null;
    });
  }

  clear() {
    this.version++;
    this.opening = null;
    this.imageCapture.clear();
    this.captureRecord = null;
    if (this.pending) this.remove(this.pending);
    for (const record of this.records.values()) this.remove(record);
    this.sessions = [];
    this.markerOffsets.clear();
    this.changed();
  }

  dispose() {
    this.clear();
    this.imageCapture.dispose();
    this.unbindDismissal();
    this.unsubscribe();
    this.sizeObserver.disconnect();
    if (this.layoutFrame !== null) cancelAnimationFrame(this.layoutFrame);
    this.resumeHost.remove();
  }
}
