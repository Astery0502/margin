const PiBrowser = (() => {
  const listeners = new Set();
  const viewId = Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, '0')).join('');
  let port;
  let retry;
  const emit = event => { for (const listener of listeners) listener(event); };
  const available = () => Boolean(chrome.runtime.id);
  const reloadError = () => Object.assign(new Error('Margin was updated. Refresh this page to reconnect. Copy any unsent question before refreshing.'), { code: 'EXTENSION_RELOADED' });

  async function message(payload) {
    if (!available()) throw reloadError();
    try { return await chrome.runtime.sendMessage({ ...payload, viewId }); }
    catch (error) { throw available() ? error : reloadError(); }
  }

  async function request(action, values = {}) {
    const response = await message({ type: 'pi-sources', action, values });
    if (response.error) throw Object.assign(new Error(response.error), { code: response.code });
    return response.result;
  }

  function reconnect(connection) {
    if (port !== connection) return;
    port = null;
    connection.disconnect();
    clearTimeout(retry);
    if (listeners.size) retry = setTimeout(() => connect(true), 1500);
  }

  function connect(restored = false) {
    if (port || !listeners.size) return;
    clearTimeout(retry);
    if (!available()) {
      const error = reloadError();
      emit({ type: 'connection', error: error.message, code: error.code });
      return;
    }
    const connection = chrome.runtime.connect({ name: 'pi-sources/' + viewId });
    port = connection;
    connection.onMessage.addListener(event => { if (port === connection) emit(event); });
    connection.onDisconnect.addListener(() => reconnect(connection));
    if (restored) emit({ type: 'connection' });
  }

  return {
    message,
    request,
    get available() { return available(); },
    subscribe(listener) {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(retry);
          const connection = port;
          port = null;
          connection?.disconnect();
        }
      };
    },
    async voice(action, sessionId, recordingId) {
      const response = await message({ type: 'pi-dictation', action, sessionId, recordingId });
      if (response.error) throw new Error(response.error);
      return response.result;
    },
  };
})();
