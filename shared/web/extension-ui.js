globalThis.PiExtensionUI = class {
  static styles = `
    .extension-request{box-sizing:border-box;max-width:760px;border:1px solid #b9cdb2;border-radius:9px;padding:12px;margin:8px auto;background:#f7faf3;color:#2d4435;min-width:0}
    .extension-request h3{font:inherit;font-weight:600;margin:0 0 8px}.extension-request p{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
    .extension-request input,.extension-request textarea,.extension-request select{display:block;width:100%;box-sizing:border-box;font:inherit;color:inherit;background:#fff;border:1px solid #c9d7bf;border-radius:5px;padding:8px;margin:8px 0}
    .extension-request textarea{min-height:100px;resize:vertical}.extension-request-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}
    .extension-request button{font:inherit;border:1px solid #c9d7bf;border-radius:5px;padding:6px 12px;background:#edf3e6;color:inherit;cursor:pointer}.extension-request button:disabled{opacity:.5;cursor:default}
    .extension-request input:focus-visible,.extension-request textarea:focus-visible,.extension-request select:focus-visible,.extension-request button:focus-visible{outline:2px solid #6b8f60;outline-offset:2px}
    .extension-request-error{color:#a04c36}.extension-request-error:empty{display:none}
  `;

  constructor(container, respond) {
    this.container = container;
    this.respond = respond;
    this.rows = new Map();
  }

  render(sessionId, requests = []) {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      this.rows.clear();
      this.container.replaceChildren();
    }
    const ids = new Set(requests.map(request => request.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.remove(); this.rows.delete(id); }
    for (const request of requests) {
      if (this.rows.has(request.id)) continue;
      const row = this.create(sessionId, request);
      this.rows.set(request.id, row);
      this.container.append(row);
    }
  }

  create(sessionId, request) {
    const form = document.createElement('form');
    form.className = 'extension-request';
    const heading = document.createElement('h3');
    heading.textContent = request.title;
    heading.id = `extension-request-${request.id}`;
    form.setAttribute('aria-labelledby', heading.id);
    form.append(heading);
    let field;
    if (request.method === 'confirm') {
      const message = document.createElement('p');
      message.textContent = request.message;
      form.append(message);
    } else {
      field = document.createElement(request.method === 'select' ? 'select' : request.method === 'editor' ? 'textarea' : 'input');
      field.setAttribute('aria-label', request.title);
      if (request.method === 'select') {
        const placeholder = new Option('Choose an option', '', true, true);
        placeholder.disabled = true;
        field.append(placeholder, ...request.options.map(option => new Option(option, option)));
        field.required = true;
      } else {
        field.value = request.prefill || '';
        field.placeholder = request.placeholder || '';
      }
      form.append(field);
    }
    const error = document.createElement('p');
    error.className = 'extension-request-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'extension-request-actions';
    let submitting = false;
    const answer = async response => {
      if (submitting) return;
      submitting = true;
      error.textContent = '';
      for (const control of form.elements) control.disabled = true;
      try {
        await this.respond(sessionId, request.id, response);
        if (this.sessionId === sessionId) { form.remove(); this.rows.delete(request.id); }
      } catch (failure) { error.textContent = failure.message; }
      finally {
        submitting = false;
        for (const control of form.elements) control.disabled = false;
      }
    };
    const button = (label, response) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = label;
      control.addEventListener('click', () => answer(response));
      return control;
    };
    actions.append(button('Cancel', { cancelled: true }));
    if (request.method === 'confirm') actions.append(button('No', { confirmed: false }), button('Yes', { confirmed: true }));
    else {
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'Submit';
      actions.append(submit);
    }
    form.addEventListener('submit', event => { event.preventDefault(); if (field && form.reportValidity()) answer({ value: field.value }); });
    form.append(error, actions);
    return form;
  }
};
