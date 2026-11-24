import { env, pipeline } from './lib/transformers.min.js';
const modelId = 'Xenova/whisper-tiny';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = new URL('./models/', location.href).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = new URL('./lib/', location.href).href;

onmessage = async ({ data }) => {
  try {
    const recognize = await pipeline('automatic-speech-recognition', modelId, { device: 'wasm', dtype: 'q8', local_files_only: true });
    const result = await recognize(data, { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' });
    if (!result.text?.trim()) throw new Error('No speech was recognized.');
    postMessage({ text: result.text.trim() });
  } catch (error) { postMessage({ error: error.message }); }
};
