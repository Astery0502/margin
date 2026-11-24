import { stream } from '@earendil-works/pi-ai/api/openai-responses';

// Transfer a dedicated port per request so concurrent agents can stop independently.
async function nativeFetch(generation, url, init) {
  if (String(url) !== 'https://api.openai.com/v1/responses' || init.method !== 'POST') throw new Error('Unsupported model endpoint.');
  const signal = init.signal;
  signal?.throwIfAborted();
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve, reject) => {
    let controller;
    function close() {
      port1.close();
      signal?.removeEventListener('abort', abort);
    }
    function abort() {
      port1.postMessage({ cancel: true });
      fail(signal?.reason || new Error('Request cancelled.'));
    }
    function fail(error) {
      controller?.error(error);
      reject(error);
      close();
    }
    port1.onmessage = ({ data }) => {
      if (data.error) {
        if (controller) return fail(new Error(data.error));
        // A rejected fetch is reduced to "Connection error" by the SDK.
        resolve(Response.json({ error: { message: data.error } }, { status: data.status || 502 }));
        close();
        return;
      }
      if (data.start) {
        const body = new ReadableStream({
          start(streamController) { controller = streamController; },
          cancel() { port1.postMessage({ cancel: true }); close(); },
        });
        resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
      } else if (data.chunk) controller.enqueue(Uint8Array.from(atob(data.chunk), c => c.charCodeAt(0)));
      else if (data.done) { controller?.close(); close(); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    postMessage({ responseBody: init.body, generation, port: port2 }, [port2]);
  });
}

export function streamReply(model, context, options, settings, generation) {
  return stream(model, context, { ...options, fetch: (url, init) => nativeFetch(generation, url, init), apiKey: 'native-transport', maxRetries: 0,
    onPayload(params) {
      if (params.tools?.length) {
        params.input.unshift({ type: 'additional_tools', role: 'developer', tools: params.tools });
        delete params.tools;
      }
      for (const item of params.input) if (item.role === 'system') item.role = 'developer';
      return params;
    },
    reasoningEffort: options.reasoning, serviceTier: settings.tier === 'fast' ? 'priority' : undefined });
}
