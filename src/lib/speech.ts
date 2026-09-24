import { supabase } from "@/integrations/supabase/client";
import {
  requestIosMixableSession,
  beginIosSpeechSession,
  endIosSpeechSession,
  onIosAudioSessionInterrupted,
} from "@/lib/audio-session";


type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu;

/** Anything that a synthesizer can actually pronounce. */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

/**
 * Slightly-brisker-than-normal pace applied to the device voice. 1.0 is the
 * system default; this stops sentences dragging without sounding rushed.
 */
export const SPEECH_RATE = 1;

export function cleanForSpeech(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Device speech. Sentences are read by the browser's built-in speech engine
// (SpeechSynthesis) using whatever voice the user has selected on their
// device. No network, no cost, no loading — the sentence starts on the press.
// ---------------------------------------------------------------------------

let audibleSpeaking = false;
let requestSequence = 0;
/** Strong reference to the live utterance: WebKit garbage-collects otherwise. */
let activeUtterance: SpeechSynthesisUtterance | null = null;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;
let noSupportReported = false;

// Master switch synced from the user's Sound preference. Default OFF until
// preferences load, so nothing is ever spoken before we know the setting.
let speechEnabled = false;

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  if (!on) cancelSpeech();
}

export function isSpeechEnabled(): boolean {
  return speechEnabled;
}

// Temporary override held while a hands-free voice call is live: the call has
// its own voice, so no other speech path in the app may play.
let speechSuppressed = false;

export function setSpeechSuppressed(on: boolean) {
  speechSuppressed = on;
  if (on) cancelSpeech();
}

export function isSpeechSuppressed(): boolean {
  return speechSuppressed;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const engine = window.speechSynthesis;
  if (!engine || typeof engine.speak !== "function") return null;
  return engine;
}

function emitSpeechError(message: string) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("orby-speech-error", { detail: message }));
    } catch {}
  }
}

/**
 * Resolve a concrete on-device voice for the retry path. The first attempt
 * deliberately leaves `voice` unset so the engine uses the user's own default;
 * only when that never starts do we pin an explicit local voice.
 */
function fallbackVoice(engine: SpeechSynthesis): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = engine.getVoices?.() ?? [];
  } catch {
    return null;
  }
  if (voices.length === 0) return null;
  const language = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  const base = language.split("-")[0];
  return (
    voices.find((v) => v.default && v.localService) ??
    voices.find((v) => v.default) ??
    voices.find((v) => v.localService && v.lang?.startsWith(base)) ??
    voices.find((v) => v.lang?.startsWith(base)) ??
    voices.find((v) => v.localService) ??
    voices[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Gesture primer. iOS/Safari only lets speech start once the page has had a
// real user interaction, and getVoices() is often empty until then. Warm both
// on the first tap/keypress — never by queueing a silent utterance, which can
// wedge WebKit's queue.
// ---------------------------------------------------------------------------

let primerAttached = false;
let primed = false;

function primeSpeech() {
  const engine = synth();
  if (!engine) return;
  primed = true;
  try {
    engine.getVoices?.();
  } catch {}
}

function attachPrimer() {
  if (primerAttached) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  primerAttached = true;
  const onGesture = () => primeSpeech();
  for (const event of ["pointerdown", "touchend", "keydown"] as const) {
    window.addEventListener(event, onGesture, { passive: true });
  }
  const engine = synth();
  if (engine && typeof engine.addEventListener === "function") {
    // Voices arrive asynchronously on some engines.
    engine.addEventListener("voiceschanged", () => {
      try {
        engine.getVoices?.();
      } catch {}
    });
  }
  attachForegroundRecovery();
}

// ---------------------------------------------------------------------------
// Lifecycle recovery: app switches, screen locks and calls can leave WebKit's
// speech queue reporting activity while nothing plays. Clearing state on
// return guarantees the next press starts cleanly.
// ---------------------------------------------------------------------------

let recoveryListenersAttached = false;
let wasHidden = false;
let removeAudioSessionListener: (() => void) | null = null;

export function handleAppForeground() {
  cancelSpeech();
  primed = false;
  // Refresh WebKit's lazily-populated voice list. Never resume a stale queue:
  // that can revive an interrupted utterance and race the next user press.
  primeSpeech();
}

function pageIsVisible(): boolean {
  if (typeof document === "undefined" || !document.visibilityState) return true;
  return document.visibilityState === "visible";
}

function attachForegroundRecovery() {
  if (recoveryListenersAttached) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  recoveryListenersAttached = true;
  const onMaybeForeground = () => {
    if (!pageIsVisible()) {
      wasHidden = true;
      cancelSpeech();
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    handleAppForeground();
  };
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) wasHidden = true;
    onMaybeForeground();
  });
  window.addEventListener("focus", onMaybeForeground);
  window.addEventListener("pagehide", () => {
    wasHidden = true;
    cancelSpeech();
  });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onMaybeForeground);
  }
  removeAudioSessionListener?.();
  removeAudioSessionListener = onIosAudioSessionInterrupted(() => {
    wasHidden = true;
    cancelSpeech();
  });
}

// Attach lifecycle recovery as soon as the module loads in a browser, so a
// background/foreground round-trip is caught even before the first sentence.
if (typeof window !== "undefined") {
  try {
    attachForegroundRecovery();
  } catch {}
}

function clearSpeechEngine(restoreIdleSession: boolean) {
  requestSequence += 1;
  stopStream();
  audibleSpeaking = false;
  activeUtterance = null;
  if (startWatchdog) clearTimeout(startWatchdog);
  startWatchdog = null;
  const engine = synth();
  if (engine) {
    try {
      engine.cancel();
    } catch {}
  }
  if (restoreIdleSession) endIosSpeechSession();
}

export function cancelSpeech() {
  clearSpeechEngine(true);
}

export function isSpeaking(): boolean {
  return audibleSpeaking || streamPlaying;
}

/** Test hook / no-op holdover: device speech keeps no caches. */
export function resetSpeechCaches() {
  cancelSpeech();
  cache.clear();
  primed = false;
}

/**
 * Speak one sentence with the device's own voice. Returns false when speech is
 * off, suppressed, unavailable, or the text has nothing pronounceable.
 */
function speakDevice(clean: string, opts: SpeakOpts = {}): boolean {

  const engine = synth();
  if (!engine) {
    if (!noSupportReported) {
      noSupportReported = true;
      emitSpeechError("This device doesn't support reading aloud.");
    }
    opts.onError?.();
    return false;
  }

  attachPrimer();
  if (!primed) primeSpeech();
  // One cancellation, then one fresh utterance in the same user gesture. A
  // delayed reset loop can erase a newer swipe after returning from an app.
  clearSpeechEngine(false);
  const sequence = requestSequence;

  const speak = (voice: SpeechSynthesisVoice | null, isRetry: boolean) => {
    // This does not open, stop or release a microphone. `transient` asks iOS to
    // duck other audio; unsupported builds fall back to ambient mixing.
    beginIosSpeechSession();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = opts.rate ?? SPEECH_RATE;
    if (opts.pitch !== undefined) utterance.pitch = opts.pitch;
    if (voice) {
      utterance.voice = voice;
      if (voice.lang) utterance.lang = voice.lang;
    }

    const settle = () => {
      if (sequence !== requestSequence) return false;
      if (startWatchdog) clearTimeout(startWatchdog);
      startWatchdog = null;
      audibleSpeaking = false;
      activeUtterance = null;
      endIosSpeechSession();
      return true;
    };

    utterance.onstart = () => {
      if (sequence !== requestSequence) return;
      if (startWatchdog) clearTimeout(startWatchdog);
      startWatchdog = null;
      audibleSpeaking = true;
    };
    utterance.onend = () => {
      if (!settle()) return;
      opts.onEnd?.();
    };
    utterance.onerror = () => {
      if (sequence !== requestSequence) return;
      if (!isRetry) {
        // A rejected utterance on iOS usually means the implicit default voice
        // could not be resolved — try once with an explicit local voice.
        const retryVoice = fallbackVoice(engine);
        if (retryVoice) {
          try {
            engine.cancel();
          } catch {}
          speak(retryVoice, true);
          return;
        }
      }
      if (!settle()) return;
      emitSpeechError("Speech couldn't start — please try again");
      opts.onError?.();
    };

    activeUtterance = utterance;
    // A silently swallowed default utterance gets one concrete local-voice
    // retry. Never schedule repeated queue resets that could kill a later swipe.
    if (startWatchdog) clearTimeout(startWatchdog);
    startWatchdog = setTimeout(() => {
      if (sequence !== requestSequence || audibleSpeaking) return;
      startWatchdog = null;
      if (!isRetry) {
        const voice = fallbackVoice(engine);
        if (voice) {
          try {
            engine.cancel();
          } catch {}
          speak(voice, true);
          return;
        }
      }
      audibleSpeaking = false;
      activeUtterance = null;
      endIosSpeechSession();
      emitSpeechError("Speech couldn't start — please try again");
      opts.onError?.();
    }, 1_200);

    try {
      engine.speak(utterance);
    } catch {
      if (!isRetry) {
        const voice = fallbackVoice(engine);
        if (voice) {
          try {
            engine.cancel();
          } catch {}
          speak(voice, true);
          return;
        }
      }
      if (!settle()) return;
      emitSpeechError("Speech couldn't start — please try again");
      opts.onError?.();
    }
  };

  speak(null, false);
  return true;
}

/** Kept for callers that still reference it — device speech needs no warming. */
export function cancelPrewarm() {}


// ---------------------------------------------------------------------------
// Streamed Gemini voice (default). Audio is played through Web Audio in the
// iPhone's shared "ambient" mode, so music, YouTube and another app's
// recording keep going. Reading aloud never touches the microphone.
// ---------------------------------------------------------------------------

export const TTS_VOICES = [
  { id: "Charon", label: "Charon", hint: "Clear, lower" },
  { id: "Fenrir", label: "Fenrir", hint: "Energetic, lower" },
  { id: "Puck", label: "Puck", hint: "Upbeat, lower" },
  { id: "Orus", label: "Orus", hint: "Firm, lower" },
  { id: "Iapetus", label: "Iapetus", hint: "Calm, lower" },
  { id: "Kore", label: "Kore", hint: "Firm, higher" },
  { id: "Aoede", label: "Aoede", hint: "Breezy, higher" },
  { id: "Leda", label: "Leda", hint: "Youthful, higher" },
  { id: "Zephyr", label: "Zephyr", hint: "Bright, higher" },
  { id: "Autonoe", label: "Autonoe", hint: "Warm, higher" },
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number]["id"];

let voice: TtsVoice = "Kore";
let highQuality = false;
export function setSpeechVoice(v: string | null | undefined) {
  if (v && TTS_VOICES.some((x) => x.id === v)) voice = v as TtsVoice;
}
export function getSpeechVoice(): TtsVoice { return voice; }
export function setSpeechHighQuality(on: boolean) { highQuality = on; }

const SAMPLE_RATE = 24_000;
const CACHE_MAX = 30;
const cache = new Map<string, Float32Array[]>();
function cacheGet(k: string) {
  const v = cache.get(k);
  if (v) { cache.delete(k); cache.set(k, v); }
  return v;
}
function cachePut(k: string, v: Float32Array[]) {
  cache.set(k, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

let ctx: AudioContext | null = null;
let streamAbort: AbortController | null = null;
let sources: AudioBufferSourceNode[] = [];
let streamPlaying = false;
let streamSeq = 0;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (ctx && ((ctx.state as string) === "closed" || (ctx.state as string) === "interrupted")) {
    try { void ctx.close(); } catch {}
    ctx = null;
  }
  if (!ctx) {
    try { ctx = new Ctor({ sampleRate: SAMPLE_RATE }); } catch { ctx = new Ctor(); }
  }
  if (ctx && ctx.state !== "running") { try { void ctx.resume(); } catch {} }
  return ctx;
}

function stopStream() {
  streamSeq += 1;
  streamAbort?.abort();
  streamAbort = null;
  for (const s of sources) { try { s.onended = null; s.stop(); } catch {} }
  sources = [];
  streamPlaying = false;
}

function pcmToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function speakStreamed(clean: string, opts: SpeakOpts): boolean {
  const ac = audioCtx();
  if (!ac || typeof fetch !== "function") return false;
  // Mixable mode: other apps keep playing/recording underneath.
  requestIosMixableSession();
  clearSpeechEngine(false);
  const seq = streamSeq;
  const key = `${highQuality ? "hq" : "lite"}|${voice}|${clean}`;
  let nextTime = 0;
  let pending = 0;
  let finished = false;
  let gotAudio = false;
  const done = () => {
    if (seq !== streamSeq || !finished || pending > 0) return;
    streamPlaying = false;
    opts.onEnd?.();
  };
  const play = (samples: Float32Array) => {
    if (seq !== streamSeq || samples.length === 0) return;
    const buf = ac.createBuffer(1, samples.length, SAMPLE_RATE);
    buf.getChannelData(0).set(samples);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    const start = Math.max(ac.currentTime + 0.02, nextTime);
    src.start(start);
    nextTime = start + buf.duration;
    pending += 1;
    streamPlaying = true;
    sources.push(src);
    src.onended = () => {
      pending -= 1;
      sources = sources.filter((s) => s !== src);
      done();
    };
  };

  const cached = cacheGet(key);
  if (cached) {
    cached.forEach(play);
    finished = true;
    done();
    return true;
  }

  const abort = new AbortController();
  streamAbort = abort;
  const chunks: Float32Array[] = [];
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("signed out");
      const res = await fetch("/api/tts", {
        method: "POST",
        signal: abort.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: clean, voice, hq: highQuality }),
      });
      if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);
      const reader = res.body.getReader();
      let carry: Uint8Array | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (seq !== streamSeq) { try { await reader.cancel(); } catch {} return; }
        if (end) break;
        let bytes = value;
        if (carry) {
          const merged = new Uint8Array(carry.length + bytes.length);
          merged.set(carry); merged.set(bytes, carry.length);
          bytes = merged; carry = null;
        }
        if (bytes.length % 2) { carry = bytes.slice(-1); bytes = bytes.slice(0, -1); }
        const f = pcmToFloat(bytes);
        if (f.length) { gotAudio = true; chunks.push(f); play(f); }
      }
      if (!gotAudio) throw new Error("empty audio");
      cachePut(key, chunks);
      finished = true;
      done();
    } catch (e) {
      if (seq !== streamSeq || (e as Error)?.name === "AbortError") return;
      if (gotAudio) { finished = true; done(); return; }
      // Last resort: the device's own voice, so reading never goes silent.
      streamPlaying = false;
      if (!speakDevice(clean, opts)) {
        emitSpeechError("Speech couldn't start — please try again");
        opts.onError?.();
      }
    }
  })();
  return true;
}

/**
 * Speak one sentence. Streams the chosen Gemini voice; falls back to OpenAI on
 * the server and to device speech on the client. Newest call always wins.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  if (!speechEnabled || speechSuppressed) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;
  if (speakStreamed(clean, opts)) return true;
  return speakDevice(clean, opts);
}
