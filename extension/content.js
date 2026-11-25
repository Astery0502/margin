(() => {
  if (document.contentType === 'application/pdf') return;
  const request = PiBrowser.request;
  const id = new URL(location.href); id.hash = '';
  const registered = request('sourceView');
  registered.catch(console.error);
  let selected = null;
  let loadVersion = 0;
  const { quickIcon, fullIcon } = passageActions;
  const host = document.createElement('div');
  host.setAttribute('data-pi-source-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#43563b}:host([hidden]),[hidden]{display:none!important}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #d3dfc6;background:#f3f7eb;color:#526c43;border-radius:8px;padding:8px 12px}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid #88a86b;outline-offset:2px}#panel{position:fixed;width:max-content;max-width:calc(100vw - 16px);background:#fffef8;border:1px solid #dbe4d0;border-radius:10px;box-shadow:0 4px 18px #26371624;padding:4px}#actions{display:flex;gap:4px}#actions button{display:flex;align-items:center;gap:6px;border:0;background:transparent;position:relative;width:32px;height:32px;justify-content:center;padding:7px}#actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}#actions button:hover{background:#edf3e4}#discuss{color:#426744;font-weight:600}#status{max-width:260px;font-size:11px;color:#92876b;margin:5px 8px;overflow-wrap:anywhere}

      #actions button::after{content:attr(aria-label);position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);padding:3px 7px;border-radius:5px;background:#36543b;color:#fff;font-size:11px;font-weight:400;pointer-events:none;opacity:0}#actions button:hover::after,#actions button:focus-visible::after{opacity:1}
      ${marginBrand.styles}${marginBrand.launcherStyles}#summary{position:relative}
    </style>
    <section id="panel" hidden><div id="actions" role="toolbar" aria-label="Discuss passage"><button id="discuss" aria-label="Quick">${quickIcon}</button><button id="full" aria-label="Full">${fullIcon}</button></div><p id="status" role="status" hidden></p></section><button id="summary" type="button"></button>`;
  const $ = name => shadow.getElementById(name);
  marginBrand.mountLauncher($('summary'));
  document.body.append(host);
  function status(message) {
    $('status').textContent = message;
    $('status').hidden = !message;
    if (!$('panel').hidden) positionCapture();
  }
  function renderCapture() {
    for (const name of ['discuss', 'full']) {
      $(name).disabled = !PiBrowser.available || Boolean(discussions.opening) || !selected;
      $(name).setAttribute('aria-busy', String(Boolean(discussions.opening)));
    }
  }

  function dismissCapture() { selected = null; $('panel').hidden = true; renderCapture(); }

  function passageEnd(range) {
    return [...range.getClientRects()].filter(rect => rect.width && rect.height).at(-1);
  }

  function positionCapture() {
    const rect = selected ? passageEnd(selected) : $('summary').getBoundingClientRect();
    const panel = $('panel');
    const { width, height } = panel.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right + 6), innerWidth - width - 8);
    const top = rect.top >= height + 16 ? rect.top - height - 8 : rect.bottom + 8;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.min(Math.max(8, top), innerHeight - height - 8)}px`;
  }

  function createFrame(session) {
    try {
      const range = PiSourceAnchors.range(session.source);
      const marker = document.createElement('div');
      marker.setAttribute('data-pi-source-ui', '');
      if (session.id) marker.dataset.piSessionId = session.id;
      else marker.setAttribute('data-pi-pending-discussion', '');
      const mark = marker.attachShadow({ mode: 'open' });
      mark.innerHTML = `
        <style>
          ${discussionActions.styles}${discussionWindow.styles}
          :host{all:initial;display:contents;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#43563b}*{box-sizing:border-box}[hidden]{display:none!important}section{border:1px solid #7d9c68;border-radius:10px;overflow:hidden}button{font:inherit;cursor:pointer}#toggle{flex:1;min-width:0;text-align:left;border:0;background:transparent;color:#526c43;padding:9px 12px;display:flex;gap:9px;align-items:center;cursor:move;touch-action:none;user-select:none}#toggle:focus-visible{outline:2px solid #88a86b;outline-offset:-3px}#label{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}#pi{font:20px Georgia,serif}#bar{display:flex;align-items:center;flex:none}.new #bar{display:none}#body{flex:1;min-height:0;padding:0 12px 12px;display:flex;flex-direction:column;overflow:auto}.new #body{padding:0}
          svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}#launcher{touch-action:none;user-select:none;position:fixed;z-index:2147483645;width:28px;height:28px;padding:5px;display:flex;align-items:center;justify-content:center;border:1px solid #c9d8bd;border-radius:9px;background:#f7f9f1;color:#526c43;box-shadow:0 2px 7px #26371618}#launcher:hover{background:#eaf1e1}#launcher:focus-visible{outline:2px solid #88a86b;outline-offset:2px}#launcher::after{content:attr(data-mode);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);padding:3px 7px;border-radius:5px;background:#36543b;color:#fff;font-size:11px;pointer-events:none;opacity:0}#launcher:hover::after,#launcher:focus-visible::after{opacity:1}.floating-dialog{z-index:2147483646;display:flex;flex-direction:column;box-shadow:0 8px 30px #26371630;background:#fffef8}
        </style>
        <button id="launcher" aria-label="Quick" aria-controls="body" aria-expanded="false" hidden>${quickIcon}</button>
        <section class="floating-dialog" role="dialog" aria-labelledby="label">
          <div id="bar"><button id="toggle" aria-expanded="false" aria-controls="body"><span id="pi">${marginBrand.icon}</span><span id="label"></span></button><div id="card-actions" class="discussion-actions">${discussionActions.buttons()}${discussionActions.panelButton}</div></div>
          <div id="body" hidden></div>
        </section>`;
      const section = mark.querySelector('section');
      const toggle = mark.getElementById('toggle');
      const launcher = mark.getElementById('launcher');
      marker.style.display = 'contents';
      document.body.append(marker);
      const placeMarker = discussions.bindMarker(launcher, () => discussions.records.get(marker.dataset.piSessionId).session);
      return {
        range, placeMarker, section, handle: toggle, root: mark.getElementById('body'), actions: mark.getElementById('card-actions'), marker, mark,
        contains: path => path.includes(marker),
        setOpen(open) {
          section.hidden = !open;
          mark.getElementById('body').hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
          launcher.setAttribute('aria-expanded', String(open));
        },
        render(record) {
          if (record.session.id) {
            marker.removeAttribute('data-pi-pending-discussion');
            marker.dataset.piSessionId = record.session.id;
          }
          mark.getElementById('label').textContent = record.session.title;
          toggle.title = 'Drag to move';
        },
        remove: () => marker.remove(),
      };
    } catch { return null; }
  }

  function positionLauncher(record, rect, offset = 0, count = 1) {
    const launcher = record.frame.mark.getElementById('launcher');
    const session = record.session;
    launcher.dataset.mode = session.source.includeFullText ? 'Full' : 'Quick';
    launcher.setAttribute('aria-label', launcher.dataset.mode);
    launcher.innerHTML = session.source.includeFullText ? fullIcon : quickIcon;
    const fits = rect.right + 34 + (count - 1) * 32 <= innerWidth - 8;
    const left = fits ? rect.right + 6 + offset : Math.min(rect.right + 6 + (count - 1) * 32, innerWidth - 36) - offset;
    const top = fits ? rect.top - 12 : rect.top - 32;
    record.frame.placeMarker(Math.max(8, left), Math.max(8, Math.min(top, innerHeight - 36)));
    launcher.hidden = record.open || !session.id || rect.bottom < 0 || rect.top > innerHeight;
  }

  const discussions = new PiSourceDiscussions({
    sourceId: () => id.href,
    createFrame,
    anchor: record => passageEnd(record.frame.range),
    readBody: () => PiSourceAnchors.body(),
    onError: error => status(error.message),
    onSessions: sessions => { for (const session of sessions) discussions.register(session); },
    onChange: () => {
      marginBrand.updateLauncher($('summary'), discussions.sessions.length);
      renderCapture(); updatePositions();
    },
    dismissSelection: dismissCapture,
    containsSelection: path => path.includes(host),
  });

  function navigate() {
    const current = new URL(location.href); current.hash = '';
    if (current.href === id.href) return;
    discussions.clear();
    id.href = current.href;
    dismissCapture();
    loadPage();
  }

  async function loadPage() {
    const version = ++loadVersion;
    try {
      await discussions.refresh();
      if (version !== loadVersion) return;
      status('');
    } catch (error) { if (version === loadVersion) status(error.message); }
  }

  function openSidebar() {
    request('panel').then(dismissCapture).catch(error => {
      $('panel').hidden = false;
      renderCapture();
      status(error.message);
    });
  }
  $('summary').addEventListener('click', openSidebar);
  $('panel').addEventListener('mousedown', event => event.preventDefault());
  async function discuss(includeFullText) {
    if (discussions.opening || !selected) return;
    const captured = selected;
    const source = PiSourceAnchors.source(captured);
    if (!source) { status('Select the passage again to start a discussion.'); return; }
    dismissCapture(); status('');
    try { await discussions.prepare(source, includeFullText); }
    catch (error) { selected ||= captured; $('panel').hidden = false; status(error.message); }
  }
  $('discuss').addEventListener('click', () => discuss(false));
  $('full').addEventListener('click', () => discuss(true));

  function capture(event) {
    if (discussions.imageCapture.active || event.composedPath().some(node => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-pi-source-ui'))) return;
    if (event.key === 'Escape') { dismissCapture(); return; }
    const range = PiSourceAnchors.selectionRange();
    if (!range) { dismissCapture(); return; }
    selected = range.cloneRange(); renderCapture(); $('panel').hidden = false;
    positionCapture();
  }
  document.addEventListener('mouseup', capture);
  document.addEventListener('keyup', capture);
  document.addEventListener('scroll', dismissCapture, true);
  let layoutFrame = null;
  function updatePositions() {
    if (layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      const positions = new Map();
      for (const record of discussions.records.values()) {
        const rect = passageEnd(record.frame.range);
        const key = `${rect.right},${rect.top}`;
        if (!positions.has(key)) positions.set(key, []);
        positions.get(key).push({ record, rect });
      }
      for (const group of positions.values()) group.forEach(({ record, rect }, index) => {
        positionLauncher(record, rect, index * 32, group.length);
      });
    });
  }
  document.addEventListener('scroll', () => { updatePositions(); discussions.layout(); }, true);
  window.addEventListener('resize', () => {
    dismissCapture(); updatePositions(); discussions.layout();
  });
  const unsubscribe = PiBrowser.subscribe(event => {
    if (event.type === 'connection' && event.code === 'EXTENSION_RELOADED') {
      $('panel').hidden = false;
      renderCapture();
      status(event.error);
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type !== 'pi-source-content') return;
    if (message.action === 'identity') { const current = new URL(location.href); current.hash = ''; respond({ sourceId: current.href }); return; }
    if (message.action === 'navigation') { navigate(); respond({ updated: true }); return; }
    if (message.action === 'selection') {
      const open = async () => {
        selected = PiSourceAnchors.selectionRange()?.cloneRange();
        if (!selected) throw new Error('Select the passage again to start a discussion.');
        await discuss(false);
        return { opened: true };
      };
      open().then(respond, error => respond({ error: error.message }));
      return true;
    }
    try {
      if (message.action === 'body') respond({ text: PiSourceAnchors.body() });
      else if (message.action === 'locate') {
        PiSourceAnchors.locate(message.source);
        discussions.refresh().catch(error => status(error.message));
        respond({ located: true });
      }
    } catch (error) { respond({ error: error.message }); }
  });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { discussions.dispose(); unsubscribe(); if (layoutFrame !== null) cancelAnimationFrame(layoutFrame); }
  });
  registered.then(loadPage).catch(error => status(error.message));
})();
