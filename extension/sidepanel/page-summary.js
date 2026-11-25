function bytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function pageSummary(source, feedback) {
  const node = document.getElementById('page-summary-template').content.firstElementChild.cloneNode(true);
  const usage = node.querySelector('.usage');
  const clear = node.querySelector('[data-action="clear"]');
  const download = node.querySelector('[data-action="export"]');
  const request = action => PiBrowser.request(action, { sourceId: source.id });

  let pending = false;
  let dirty = false;
  async function refresh() {
    if (pending) { dirty = true; return; }
    pending = true;
    try {
      const result = await request('storage');
      usage.textContent = `${result.count} discussions · ${bytes(result.totalBytes)}${result.archivedCount ? ` · ${result.archivedCount} archived` : ''}`;
      node.querySelector('[data-field="history"]').textContent = bytes(result.historyBytes);
      node.querySelector('[data-field="text"]').textContent = bytes(result.sourceBytes);
      node.querySelector('[data-field="files"]').textContent = `${result.workingFiles} · ${bytes(result.workingBytes)}`;
      node.querySelector('dl').hidden = false;
      clear.hidden = !result.workingFiles;
    } catch (error) { usage.textContent = error.message; }
    finally {
      pending = false;
      if (dirty) { dirty = false; refresh(); }
    }
  }

  clear.addEventListener('click', async () => {
    if (!confirm(`Clear working files for “${source.title}”? Discussion history and saved page text are kept.`)) return;
    clear.disabled = true;
    try {
      await request('clearPageFiles');
      await refresh();
      feedback('Working files cleared.');
    } catch (error) { feedback(error.message, true); }
    finally { clear.disabled = false; }
  });

  download.addEventListener('click', async () => {
    download.disabled = true;
    try {
      const data = await request('exportPage');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'margin-discussions.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      feedback(`Exported ${data.discussions.length} discussions.`);
    } catch (error) { feedback(error.message, true); }
    finally { download.disabled = false; }
  });

  refresh();
  return { id: source.id, node, refresh };
}
