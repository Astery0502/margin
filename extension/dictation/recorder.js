export class DictationRecorder {
  constructor({ onState = () => {}, onText = () => {}, onError = () => {}, onLevel, prepare, deliver, request } = {}) {
    Object.assign(this, { onState, onText, onError, onLevel, prepare, request, deliver });
    this.state = 'idle';
    this.task = null;
    this.onPageHide = () => this.dispose();
    window.addEventListener('pagehide', this.onPageHide);
  }

  get targetId() { return this.task?.targetId; }

  setState(state) {
    this.state = state;
    const task = this.task;
    this.onState(state, this.targetId, task ? { recordingId: task.id, duration: task.duration || 0, error: task.error } : {});
  }

  async start(targetId) {
    if (this.task) return;
    const task = { id: crypto.randomUUID(), targetId, controller: new AbortController(), chunks: [], duration: 0 };
    this.task = task;
    this.setState('preparing');
    try {
      await this.prepare({ signal: task.controller.signal });
      if (this.task !== task || task.cancelled) return;
      this.setState('requesting');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.task !== task || task.cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      task.stream = stream;
      task.recorder = new MediaRecorder(stream);
      task.mimeType = task.recorder.mimeType;
      task.stopped = new Promise(resolve => { task.resolveStop = resolve; });
      task.recorder.addEventListener('start', () => {
        if (this.task !== task || task.cancelled) return;
        task.startedAt = performance.now();
        task.mimeType = task.recorder.mimeType;
        task.timer = setInterval(() => {
          task.duration = (performance.now() - task.startedAt) / 1000;
          this.setState(this.state);
        }, 1000);
        this.setState('recording');
      });
      task.recorder.addEventListener('dataavailable', event => {
        if (!event.data.size || this.task !== task || task.cancelled) return;
        task.chunks.push(event.data);
      });
      task.recorder.addEventListener('stop', () => {
        this.release(task);
        if (this.task === task && !task.cancelled) task.operation = this.finish(task, !task.manualStop);
        task.resolveStop();
      });
      task.recorder.addEventListener('error', event => { task.captureError = event.error.message; });
      if (this.onLevel) await this.startMeter(task);
      if (this.task === task && !task.cancelled) task.recorder.start(1000);
    } catch (error) { this.fail(task, error); }
  }

  async startMeter(task) {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaStreamSource(task.stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const meter = { context, source };
    task.meter = meter;
    await context.resume();
    if (this.task !== task || task.cancelled) return;
    meter.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      this.onLevel(Math.min(1, Math.sqrt(energy / samples.length) * 8), task.targetId);
    }, 80);
  }

  stopMeter(task) {
    const meter = task.meter;
    if (!meter) return;
    task.meter = null;
    clearInterval(meter.timer);
    meter.source.disconnect();
    void meter.context.close();
  }

  release(task) {
    if (!task) return;
    clearInterval(task.timer);
    if (task.startedAt) { task.endedAt ||= performance.now(); task.duration = (task.endedAt - task.startedAt) / 1000; }
    this.stopMeter(task);
    if (task.recorder?.state === 'recording') task.recorder.stop();
    task.stream?.getTracks().forEach(track => track.stop());
  }

  async stop() {
    const task = this.task;
    if (!task || this.state !== 'recording') return;
    task.manualStop = true;
    this.release(task);
    await task.stopped;
    await task.operation;
  }

  async finish(task, interrupted = false) {
    try {
      if (this.task !== task || task.cancelled) return;
      if (!task.chunks.length) throw new Error('No audio was captured. Check the microphone and try again.');
      if (interrupted || task.captureError) throw new Error(task.captureError || 'Recording ended unexpectedly. The captured audio is kept; retry to transcribe it.');
      if (!task.text) {
        this.setState('transcribing');
        const result = await this.request('transcribe', task, { audio: this.audio() });
        task.text = result.text;
      }
      if (this.task !== task || task.cancelled) return;
      this.setState('delivering');
      if (!task.delivered) {
        await this.onText(task.text, task.targetId, task.id);
        if (this.task !== task || task.cancelled) return;
        task.delivered = true;
      }
      await this.deliver(task);
      if (this.task !== task || task.cancelled) return;
      this.task = null;
      this.setState('idle');
    } catch (error) { this.fail(task, error); }
  }

  async retry() {
    if (this.state !== 'error') return;
    const task = this.task;
    task.error = null;
    task.captureError = null;
    task.controller = new AbortController();
    task.operation = this.finish(task);
    await task.operation;
  }

  audio() {
    if (!this.task?.chunks.length) return null;
    return new Blob(this.task.chunks, { type: this.task.mimeType });
  }

  async cancel() {
    const task = this.task;
    if (!task) return;
    task.cancelled = true;
    task.controller.abort();
    this.release(task);
    this.task = null;
    this.setState('idle');
  }

  fail(task, error) {
    if (this.task !== task || task.cancelled) return;
    this.release(task);
    if (task.chunks.length) {
      task.error = error.message;
      this.setState('error');
    } else {
      this.task = null;
      this.setState('idle');
    }
    this.onError(error, task.targetId);
  }

  dispose() {
    void this.cancel();
    window.removeEventListener('pagehide', this.onPageHide);
  }
}
