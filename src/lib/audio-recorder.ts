// Record microphone input as PCM via the Web Audio API and encode a complete
// 16 kHz mono WAV Blob on stop. Deliberately avoids MediaRecorder timeslice —
// only WAV is guaranteed decodable everywhere (iOS Safari records fragmented
// MP4, which the transcription model rejects).

import { beginIosRecordingSession, endIosRecordingSession } from "@/lib/audio-session";

export type PcmRecorder = {
  /** Resolves once the mic is genuinely delivering audio frames. */
  ready: Promise<void>;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

const TARGET_RATE = 16000;
const MIC_RETRY_DELAYS_MS = [0, 300, 800] as const;
const CONTEXT_RESUME_TIMEOUT_MS = 500;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// Downsample a PCM buffer from srcRate → TARGET_RATE with a simple
// average-window filter. Adequate for speech.
function downsampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_RATE) return input;
  if (srcRate < TARGET_RATE) return input; // upsampling not needed for STT
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const next = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = pos; j < next && j < input.length; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
    pos = next;
  }
  return out;
}

// Keep the mic stream warm between recordings. Cold-starting getUserMedia can
// take a second, which is exactly the window where the user has already seen
// the red glow and started talking.
//
// ONE AudioContext is reused for the recorder's whole lifetime: iOS enforces a
// low hardware limit on live audio contexts and closes them asynchronously, so
// creating one per recording eventually makes the system refuse new ones —
// until then every mic press failed with "access is needed" until reload.
let recorderContext: AudioContext | null = null;
let warm: { stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null;
let micGeneration = 0;
let activeRecorders = 0;
let recorderContextStale = false;
let lifecycleInstalled = false;
let iosRecordingSessionToken: number | null = null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDomException(message: string, name: string) {
  if (typeof DOMException !== "undefined") return new DOMException(message, name);
  const error = new Error(message) as Error & { name: string };
  error.name = name;
  return error;
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

function closeRecorderContext() {
  const ctx = recorderContext;
  recorderContext = null;
  recorderContextStale = false;
  if (!ctx || ctx.state === "closed") return;
  try {
    void ctx.close().catch(() => {});
  } catch {}
}

function beginMicSession() {
  if (iosRecordingSessionToken === null) {
    iosRecordingSessionToken = beginIosRecordingSession();
  }
}

function endMicSession() {
  const token = iosRecordingSessionToken;
  iosRecordingSessionToken = null;
  endIosRecordingSession(token);
}

function maybeCloseStaleContext() {
  if (!recorderContextStale || activeRecorders > 0) return;
  closeRecorderContext();
}

function retireRecorderContext() {
  recorderContextStale = true;
  teardownWarm(true);
  maybeCloseStaleContext();
}

function installRecorderLifecycle() {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;
  const markStaleOnReturn = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    // Returning from another app on iOS can leave the old mic/audio session in
    // a zombie state. Drop it so the next user press starts cleanly.
    retireRecorderContext();
  };
  window.addEventListener("pageshow", markStaleOnReturn);
  window.addEventListener("focus", markStaleOnReturn);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", markStaleOnReturn);
  }
}

function acquireRecorderContext(): AudioContext {
  installRecorderLifecycle();
  const AudioCtx =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw makeDomException("Audio recording is not supported in this browser", "NotSupportedError");
  }
  if (!recorderContext || recorderContext.state === "closed" || recorderContextStale) {
    if (recorderContextStale && activeRecorders === 0) closeRecorderContext();
    const created: AudioContext = new AudioCtx();
    recorderContext = created;
    recorderContextStale = false;
  }
  return recorderContext;
}

async function resumeRecorderContext(ctx: AudioContext) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((ctx.state as string) === "running") return;
    try {
      await Promise.race([
        ctx.resume(),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(makeDomException("Audio context resume timed out", "AbortError")),
            CONTEXT_RESUME_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {}
    if ((ctx.state as string) === "running") return;
    await delay(80);
  }
  throw makeDomException("Audio context could not start", "InvalidStateError");
}

function suspendRecorderContext() {
  const ctx = recorderContext;
  if (!ctx || ctx.state !== "running") return;
  try {
    void ctx.suspend().catch(() => {});
  } catch {}
}

function warmIsLive() {
  if (!warm) return false;
  if (recorderContextStale) return false;
  const state = (recorderContext?.state ?? "closed") as string;
  if (state === "closed" || state === "interrupted") return false;
  const tracks = warm.stream.getAudioTracks();
  return tracks.length > 0 && tracks.every((t) => t.readyState === "live");
}

function isTransientMicError(error: unknown) {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = ((error as { message?: string } | null)?.message ?? "").toLowerCase();
  if (
    name === "AbortError" ||
    name === "InvalidStateError" ||
    name === "UnknownError" ||
    name === "NotReadableError"
  ) {
    return true;
  }
  return (
    message.includes("interrupted") ||
    message.includes("couldn't start") ||
    message.includes("could not start") ||
    message.includes("unable to start") ||
    message.includes("failed to start") ||
    message.includes("operation could not be completed") ||
    message.includes("audio context")
  );
}

async function getMicStreamWithRetries(requestGeneration: number) {
  installRecorderLifecycle();
  beginMicSession();
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw makeDomException("Microphone capture is not supported in this browser", "NotSupportedError");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MIC_RETRY_DELAYS_MS.length; attempt++) {
    if (MIC_RETRY_DELAYS_MS[attempt] > 0) await delay(MIC_RETRY_DELAYS_MS[attempt]);
    if (requestGeneration !== micGeneration) {
      throw makeDomException("Microphone request was superseded", "AbortError");
    }
    try {
      return await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      lastError = error;
      teardownWarm(false);
      recorderContextStale = true;
      maybeCloseStaleContext();
      if (!isTransientMicError(error) || attempt === MIC_RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
    }
  }
  throw lastError ?? makeDomException("Microphone could not start", "UnknownError");
}

// iOS kills mic tracks when the app is backgrounded or another app takes the
// mic. Drop the warm stream the moment that happens so the next recording
// re-acquires a real stream instead of capturing silence.
function watchStream(stream: MediaStream) {
  stream.getAudioTracks().forEach((track) => {
    const invalidate = () => {
      if (warm?.stream !== stream) return;
      warm = null;
      try {
        track.stop();
      } catch {}
    };
    track.addEventListener?.("ended", invalidate);
    track.addEventListener?.("mute", invalidate);
  });
}

/** Map a getUserMedia failure to an honest, actionable message (null = stay quiet). */
export function micErrorMessage(error: unknown): string | null {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  const lower = message.toLowerCase();
  // Replaced by a newer mic request (e.g. leaving the screen) — not an error.
  if (message.includes("superseded")) return null;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone permission is off — enable it for this app in Settings, then try again";
  }
  if (name === "NotSupportedError") {
    return "Microphone recording is not supported in this browser";
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another app — close it and try again";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found on this device";
  }
  if (
    name === "AbortError" ||
    name === "InvalidStateError" ||
    name === "UnknownError" ||
    lower.includes("interrupted") ||
    lower.includes("audio context") ||
    lower.includes("couldn't start") ||
    lower.includes("could not start") ||
    lower.includes("unable to start")
  ) {
    return "The microphone was interrupted by iOS — wait a moment and try again";
  }
  return "Couldn't start the microphone — please try again";
}

function teardownWarm(bumpGeneration: boolean) {
  if (bumpGeneration) micGeneration += 1;
  if (!warm) {
    endMicSession();
    return;
  }
  const releasing = warm;
  warm = null;
  try {
    releasing.source.disconnect();
  } catch {}
  releasing.stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
  // Suspend (never close) the shared context: stopping the tracks is what
  // drops the iOS recording indicator; the context itself stays reusable.
  suspendRecorderContext();
  endMicSession();
}

/**
 * Synchronously stop any held or half-closed microphone so speech playback can
 * take the audio route immediately. Callers only speak when no recording is
 * active (recording flows cancel speech first), so this never kills a live
 * take — it finishes teardown without waiting on WebKit's timers.
 */
export function stopMicForPlayback(): void {
  teardownWarm(true);
}

/** Fully release the microphone (call when leaving the screen). */
export function releaseMic(): Promise<void> {
  // Invalidate a getUserMedia request that has not resolved yet.
  teardownWarm(true);
  maybeCloseStaleContext();
  return Promise.resolve();
}

function pickMediaRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  for (const mimeType of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    } catch {}
  }
  return "";
}

function startMediaRecorderFallback(stream: MediaStream, originalError: unknown): PcmRecorder {
  if (typeof MediaRecorder === "undefined") {
    stopStream(stream);
    endMicSession();
    throw originalError;
  }
  const mimeType = pickMediaRecorderMimeType();
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  let readyResolve: () => void = () => {};
  let stopResolve: ((blob: Blob) => void) | null = null;
  let stopReject: ((error: unknown) => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    stopStream(stream);
    endMicSession();
    throw originalError;
  }

  recorder.onstart = () => readyResolve();
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    stopStream(stream);
    endMicSession();
    const error = (event as Event & { error?: unknown }).error ?? originalError;
    stopReject?.(error);
    readyResolve();
  };
  recorder.onstop = () => {
    stopStream(stream);
    endMicSession();
    const type = recorder.mimeType || mimeType || "audio/mp4";
    stopResolve?.(new Blob(chunks, { type }));
  };

  try {
    recorder.start();
  } catch {
    stopStream(stream);
    endMicSession();
    throw originalError;
  }

  return {
    ready,
    stop() {
      if (recorder.state === "inactive") {
        stopStream(stream);
        endMicSession();
        const type = recorder.mimeType || mimeType || "audio/mp4";
        return Promise.resolve(new Blob(chunks, { type }));
      }
      return new Promise((resolve, reject) => {
        stopResolve = resolve;
        stopReject = reject;
        try {
          recorder.requestData();
        } catch {}
        try {
          recorder.stop();
        } catch (error) {
          stopStream(stream);
          endMicSession();
          reject(error);
        }
      });
    },
    cancel() {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {}
      stopStream(stream);
      endMicSession();
    },
  };
}

export async function startPcmRecorder(): Promise<PcmRecorder> {
  if (!warmIsLive()) {
    await releaseMic();
    beginMicSession();
    const requestGeneration = ++micGeneration;
    let stream: MediaStream;
    try {
      stream = await getMicStreamWithRetries(requestGeneration);
    } catch (error) {
      endMicSession();
      throw error;
    }
    if (requestGeneration !== micGeneration) {
      stopStream(stream);
      endMicSession();
      throw makeDomException("Microphone request was superseded", "AbortError");
    }
    try {
      const ctx = acquireRecorderContext();
      await resumeRecorderContext(ctx);
      const source = ctx.createMediaStreamSource(stream);
      warm = { stream, source };
      watchStream(stream);
    } catch (setupError) {
      recorderContextStale = true;
      maybeCloseStaleContext();
      return startMediaRecorderFallback(stream, setupError);
    }
  }
  const active = warm;
  if (!active) throw makeDomException("Microphone is unavailable", "NotReadableError");
  const ctx = acquireRecorderContext();
  const { source } = active;
  try {
    await resumeRecorderContext(ctx);
  } catch (resumeError) {
    retireRecorderContext();
    return startPcmRecorder();
  }

  // ScriptProcessorNode is deprecated but universally supported; AudioWorklet
  // adds significant setup we don't need for a short push-to-talk clip.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let cancelled = false;
  let stopped = false;
  activeRecorders += 1;

  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  // Safety net: never leave the caller waiting on a mic that stays silent.
  const readyTimer = setTimeout(() => markReady(), 1500);

  processor.onaudioprocess = (e) => {
    if (cancelled || stopped) return;
    clearTimeout(readyTimer);
    markReady();
    const ch = e.inputBuffer.getChannelData(0);
    // Copy — the underlying buffer is reused across callbacks.
    chunks.push(new Float32Array(ch));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  // Detach only this recording's processor; the stream + context stay warm.
  const detach = () => {
    if (processor.onaudioprocess === null) return;
    clearTimeout(readyTimer);
    try {
      processor.disconnect();
    } catch {}
    try {
      source.disconnect(processor);
    } catch {}
    processor.onaudioprocess = null;
    activeRecorders = Math.max(0, activeRecorders - 1);
    maybeCloseStaleContext();
  };

  return {
    ready,
    async stop() {
      stopped = true;
      const srcRate = ctx.sampleRate;
      detach();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        merged.set(c, o);
        o += c.length;
      }
      const down = downsampleTo16k(merged, srcRate);
      return encodeWav(down, TARGET_RATE);
    },
    cancel() {
      cancelled = true;
      detach();
    },
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}
