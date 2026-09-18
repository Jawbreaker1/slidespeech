export type QuestionRecording = { stop(): void; cancel(): void };

export async function startQuestionRecording(options: {
  signal: AbortSignal;
  onLevel(level: number): void;
  onPreview(recording: Blob): void;
  onComplete(recording: Blob): void;
  onError(error: Error): void;
}): Promise<QuestionRecording> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires HTTPS or localhost. Check this page's address and microphone permission.");
  if (typeof MediaRecorder === "undefined") throw new Error("Recording is not supported in this browser. You can still type your question.");
  options.signal.throwIfAborted();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  if (options.signal.aborted) { stream.getTracks().forEach((track) => track.stop()); options.signal.throwIfAborted(); }
  let context: AudioContext | undefined;
  let meter: ReturnType<typeof setInterval> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let recorder: MediaRecorder | undefined;
  let cancelled = false;
  const chunks: Blob[] = [];
  let size = 0, lastPreview = Date.now();
  const cleanup = () => {
    clearInterval(meter); clearTimeout(limit); options.signal.removeEventListener("abort", cancel);
    stream.getTracks().forEach((track) => track.stop());
    if (context) void context.close().catch(() => undefined);
  };
  function cancel() {
    cancelled = true;
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== "inactive") recorder.stop(); }
    cleanup();
  }
  try {
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const activeRecorder = recorder;
    const stop = () => { if (!cancelled && activeRecorder.state !== "inactive") activeRecorder.stop(); };
    recorder.ondataavailable = (event) => {
      if (cancelled || !event.data.size) return;
      chunks.push(event.data); size += event.data.size;
      if (size > 4_800_000) { cancel(); options.onError(new Error("Recording is too large. Please ask a shorter question.")); return; }
      if (Date.now() - lastPreview >= 4000 && activeRecorder.state === "recording") {
        lastPreview = Date.now(); options.onPreview(new Blob(chunks, { type: activeRecorder.mimeType }));
      }
    };
    recorder.onstop = () => {
      cleanup();
      if (!cancelled) options.onComplete(new Blob(chunks, { type: activeRecorder.mimeType }));
    };
    recorder.onerror = () => { cancel(); options.onError(new Error("Microphone recording failed. Check microphone access and try again.")); };
    options.signal.addEventListener("abort", cancel, { once: true });
    // This meter indicates input level only; it does not classify speech or questions.
    if (typeof AudioContext !== "undefined") {
      try {
        context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        meter = setInterval(() => { analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); options.onLevel(Math.min(1, rms * 8)); }, 100);
      } catch { if (context) void context.close().catch(() => undefined); context = undefined; }
    }
    if (options.signal.aborted) { cancel(); options.signal.throwIfAborted(); }
    recorder.start(1000); limit = setTimeout(stop, 85_000);
    return { stop, cancel };
  } catch (error) { cancel(); throw error; }
}
