import { env, pipeline, SuppressTokensAtBeginLogitsProcessor } from './lib/transformers.min.js';
import model from './model.json' with { type: 'json' };

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = new URL('./lib/', location.href).href;

async function prepareModel() {
  const cache = await caches.open('margin-dictation-model');
  const base = new URL(model.repository + '/resolve/' + model.revision + '/', env.remoteHost);
  env.customCache = cache;
  const cached = new Set((await cache.keys()).map(request => request.url));
  const missing = Object.entries(model.files).filter(([file]) => !cached.has(new URL(file, base).href));
  if (!missing.length) return;
  postMessage({ state: 'downloading' });
  try {
    for (const [file, integrity] of missing) {
      await cache.add(new Request(new URL(file, base), { integrity, credentials: 'omit', cache: 'no-store' }));
    }
  } catch {
    throw new Error('Could not download and save the verified speech model. Check your connection and available storage, then retry.');
  }
  postMessage({ state: 'transcribing' });
}

// Whisper predicts the language immediately after its start token. Let it choose
// between the two language tokens, then complete the usual transcription prefix.
function bilingualOptions(config) {
  const chinese = config.lang_to_id['<|zh|>'];
  const english = config.lang_to_id['<|en|>'];
  const prefix = (ids, logits) => {
    const position = ids[0].length;
    if (position > 3) return logits;
    const scores = logits.data;
    let token;
    if (position === 1) token = scores[chinese] > scores[english] ? chinese : english;
    else if (position === 2) token = config.task_to_id.transcribe;
    else token = config.no_timestamps_token_id;
    scores.fill(-Infinity);
    scores[token] = 0;
    return logits;
  };
  return {
    decoder_input_ids: [config.decoder_start_token_id],
    begin_suppress_tokens: null,
    logits_processor: [prefix, new SuppressTokensAtBeginLogitsProcessor(config.begin_suppress_tokens, 4)],
  };
}

// Detect the language again after a pause. Within continuous speech the pipeline
// still uses overlapping 30-second windows to avoid cutting words at a boundary.
function* phrases(samples, sampleRate) {
  const frame = Math.round(sampleRate * 0.02);
  const pause = Math.round(sampleRate * 0.45);
  const padding = Math.round(sampleRate * 0.12);
  const maxSilenceAmplitude = 0.003;
  const silenceFraction = 0.02;
  const peakLimit = maxSilenceAmplitude / silenceFraction;
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    if (peak >= peakLimit) break;
  }
  if (!peak) return;
  const silencePower = Math.min(maxSilenceAmplitude, peak * silenceFraction) ** 2;
  let start = 0;
  let lastVoiceEnd = 0;
  for (let offset = 0; offset < samples.length; offset += frame) {
    const end = Math.min(offset + frame, samples.length);
    let energy = 0;
    for (let i = offset; i < end; i++) energy += samples[i] * samples[i];
    if (energy < (end - offset) * silencePower) continue;
    if (offset - lastVoiceEnd >= pause) {
      if (lastVoiceEnd > 0) yield samples.subarray(start, lastVoiceEnd + padding);
      start = offset - padding;
    }
    lastVoiceEnd = end;
  }
  if (lastVoiceEnd) yield samples.subarray(start, lastVoiceEnd + padding);
}

onmessage = async ({ data: { samples, language } }) => {
  try {
    await prepareModel();
    const recognize = await pipeline('automatic-speech-recognition', model.repository, {
      revision: model.revision, device: 'wasm', dtype: 'q8', local_files_only: true,
    });
    const automatic = language === 'auto';
    const options = automatic ? bilingualOptions(recognize.model.generation_config) : { language };
    const segments = automatic ? phrases(samples, recognize.processor.feature_extractor.config.sampling_rate) : [samples];
    let transcript = '';
    for (const segment of segments) {
      const result = await recognize(segment, { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...options });
      const text = result.text?.replaceAll('[BLANK_AUDIO]', '').trim();
      if (!text) continue;
      const chineseBoundary = /[\p{Script=Han}。！？、，；：]$/u.test(transcript) && /^\p{Script=Han}/u.test(text);
      if (transcript && !chineseBoundary) transcript += ' ';
      transcript += text;
    }
    if (!transcript) throw new Error('No speech was recognized.');
    postMessage({ text: transcript });
  } catch (error) { postMessage({ error: error.message }); }
};
