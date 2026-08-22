// Record microphone input as PCM via the Web Audio API and encode a complete
// 16 kHz mono WAV Blob on stop. Deliberately avoids MediaRecorder timeslice —
// only WAV is guaranteed decodable everywhere (iOS Safari records fragmented
// MP4, which the transcription model rejects).

export type PcmRecorder = {
  /** Resolves once the mic is genuinely delivering audio frames. */
  ready: Promise<void>;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

const TARGET_RATE = 16000;

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

// Keep the mic stream + AudioContext warm between recordings. Cold-starting
// getUserMedia can take a second, which is exactly the window where the user
// has already seen the red glow and started talking.
let warm: { stream: MediaStream; ctx: AudioContext; source: MediaStreamAudioSourceNode } | null =
  null;
let closing: Promise<void> | null = null;
let micGeneration = 0;
// Recordings that are genuinely capturing right now. Speech must never kill a
// live recording, but it MUST reclaim the audio route from a mic that is only
// being kept warm or is still closing — otherwise iOS keeps the session in
// play-and-record and speech routes to the earpiece/AirPods only.

function warmIsLive() {
  if (!warm) return false;
  const tracks = warm.stream.getAudioTracks();
  return (
    tracks.length > 0 &&
    tracks.every((t) => t.readyState === "live") &&
    warm.ctx.state !== "closed"
  );
}

/** Fully release the microphone (call when leaving the screen). */
export function releaseMic(): Promise<void> {
  // Invalidates getUserMedia requests that have not resolved yet. Without this,
  // a late permission result can restore a live recording route after a swipe
  // has already switched iOS back to speaker playback.
  micGeneration += 1;
  if (warm) {
    const releasing = warm;
    warm = null;
    try {
      releasing.source.disconnect();
    } catch {}
    releasing.stream.getTracks().forEach((t) => t.stop());
    closing = releasing.ctx.close().catch(() => {}).then(() => {
      closing = null;
    });
  }
  return closing ?? Promise.resolve();
}

export async function startPcmRecorder(): Promise<PcmRecorder> {
  if (!warmIsLive()) {
    await releaseMic();
    const requestGeneration = ++micGeneration;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (requestGeneration !== micGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Microphone request was superseded", "AbortError");
    }
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    warm = { stream, ctx, source };
  }
  const active = warm;
  if (!active) throw new DOMException("Microphone is unavailable", "NotReadableError");
  const { ctx, source } = active;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {}
  }

  // ScriptProcessorNode is deprecated but universally supported; AudioWorklet
  // adds significant setup we don't need for a short push-to-talk clip.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let cancelled = false;
  let stopped = false;

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
    clearTimeout(readyTimer);
    try {
      processor.disconnect();
    } catch {}
    try {
      source.disconnect(processor);
    } catch {}
    processor.onaudioprocess = null;
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
