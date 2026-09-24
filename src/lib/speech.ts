import { supabase } from "@/integrations/supabase/client";
import { requestIosMixableSession, onIosAudioSessionInterrupted } from "@/lib/audio-session";

/**
 * Sentence speech: Gemini 3.8 Flash-Lite streamed as 24 kHz PCM and played via
 * Web Audio in iOS's shared "ambient" mode (music/recordings keep going).
 * No fallbacks: if Gemini fails, a "Speech error" event is emitted.
 */

type SpeakOpts = { rate?: number; pitch?: number; onEnd?: () => void; onError?: () => void };

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu;
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

export function cleanForSpeech(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

let speechEnabled = false;
export function setSpeechEnabled(on: boolean) { speechEnabled = on; if (!on) cancelSpeech(); }
export function isSpeechEnabled() { return speechEnabled; }

let speechSuppressed = false;
export function setSpeechSuppressed(on: boolean) { speechSuppressed = on; if (on) cancelSpeech(); }
export function isSpeechSuppressed() { return speechSuppressed; }

function emitSpeechError(message = "Speech error") {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent("orby-speech-error", { detail: message })); } catch {}
}

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
export function setSpeechVoice(v: string | null | undefined) {
  if (v && TTS_VOICES.some((x) => x.id === v)) voice = v as TtsVoice;
}
export function getSpeechVoice(): TtsVoice { return voice; }

// ---- auth token cache (avoids awaiting getSession on every press) ----
let accessToken: string | null = null;
let authWired = false;
function wireAuth() {
  if (authWired || typeof window === "undefined") return;
  authWired = true;
  void supabase.auth.getSession().then(({ data }) => { accessToken = data.session?.access_token ?? null; });
  supabase.auth.onAuthStateChange((_e, s) => { accessToken = s?.access_token ?? null; });
}
async function getToken(): Promise<string | null> {
  if (accessToken) return accessToken;
  const { data } = await supabase.auth.getSession();
  accessToken = data.session?.access_token ?? null;
  return accessToken;
}

// ---- cache ----
const SAMPLE_RATE = 24_000;
const CACHE_MAX = 80;
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

// ---- audio ----
let ctx: AudioContext | null = null;
let streamAbort: AbortController | null = null;
let sources: AudioBufferSourceNode[] = [];
let streamPlaying = false;
let streamSeq = 0;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
function scheduleIdleSuspend() {
  clearIdle();
  idleTimer = setTimeout(() => { idleTimer = null; if (!streamPlaying) suspendCtx(); }, 2000);
}
function suspendCtx() {
  if (ctx && ctx.state === "running") { try { void ctx.suspend(); } catch {} }
}

/** Created lazily, only when a sentence is about to play, at the device's own rate. */
function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  requestIosMixableSession();
  const st = ctx?.state as string | undefined;
  if (ctx && st === "closed") ctx = null;
  if (!ctx) { try { ctx = new Ctor(); } catch { return null; } }
  if (ctx && ctx.state !== "running") { try { void ctx.resume(); } catch {} }
  try {
    const s = (navigator as any)?.audioSession;
    if (s) console.debug("[orby-audio]", s.type, s.state, ctx?.state);
  } catch {}
  return ctx;
}

let listenersAttached = false;
function attachListeners() {
  if (listenersAttached || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  listenersAttached = true;
  wireAuth();
  // Leaving the app: stop speaking and quietly pause. Never close/rebuild or
  // touch the audio mode, so other apps' music and recordings are left alone.
  const onHide = () => { cancelSpeech(); cancelPrewarm(); clearIdle(); suspendCtx(); };
  window.addEventListener("pagehide", onHide);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") onHide(); });
  }
  onIosAudioSessionInterrupted(onHide);
}
if (typeof window !== "undefined") { try { attachListeners(); } catch {} }

/** App returned to the foreground: do nothing until the user presses to read. */
export function handleAppForeground() { cancelSpeech(); }

function stopStream() {
  streamSeq += 1;
  streamAbort?.abort();
  streamAbort = null;
  for (const s of sources) { try { s.onended = null; s.stop(); } catch {} }
  sources = [];
  streamPlaying = false;
}

export function cancelSpeech() { stopStream(); }
export function isSpeaking() { return streamPlaying; }
export function resetSpeechCaches() { cancelSpeech(); cancelPrewarm(); cache.clear(); }

// ---- prewarm (fills the cache without playing) ----
let prewarmQueue: string[] = [];
let prewarmAbort: AbortController | null = null;
let prewarmBusy = false;
let prewarmGen = 0;
export function cancelPrewarm() {
  prewarmGen += 1;
  prewarmQueue = [];
  prewarmAbort?.abort();
  prewarmAbort = null;
  prewarmBusy = false;
}
/** Replace the prewarm queue with these sentences (in priority order). */
export function prewarmSpeech(texts: string[]) {
  cancelPrewarm();
  if (!speechEnabled || speechSuppressed || typeof fetch !== "function") return;
  const seen = new Set<string>();
  for (const t of texts) {
    const c = cleanForSpeech(t ?? "");
    if (!c || !SPEAKABLE_RE.test(c) || seen.has(c) || cache.has(`${voice}|${c}`)) continue;
    seen.add(c); prewarmQueue.push(c);
  }
  void runPrewarm(prewarmGen);
}
async function runPrewarm(gen: number) {
  if (prewarmBusy) return;
  prewarmBusy = true;
  try {
    // let the live sentence get the bandwidth first
    await new Promise((r) => setTimeout(r, 350));
    while (gen === prewarmGen && prewarmQueue.length) {
      const clean = prewarmQueue.shift()!;
      const v = voice;
      const key = `${v}|${clean}`;
      if (cache.has(key)) continue;
      const abort = new AbortController();
      prewarmAbort = abort;
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/tts", {
          method: "POST", signal: abort.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: clean, voice: v }),
        });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (gen !== prewarmGen) return;
        const f = pcmToFloat(bytes.length % 2 ? bytes.slice(0, -1) : bytes);
        if (f.length) cachePut(key, [f]);
      } catch { if (gen !== prewarmGen) return; }
    }
  } finally { if (gen === prewarmGen) { prewarmBusy = false; prewarmAbort = null; } }
}

function pcmToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function speakStreamed(clean: string, opts: SpeakOpts): boolean {
  attachListeners();
  clearIdle();
  const ac = audioCtx();
  if (!ac || typeof fetch !== "function") { emitSpeechError(); opts.onError?.(); return false; }
  stopStream();
  const seq = streamSeq;
  const key = `${voice}|${clean}`;
  let nextTime = 0;
  let pending = 0;
  let finished = false;
  const done = () => {
    if (seq !== streamSeq || !finished || pending > 0) return;
    streamPlaying = false;
    scheduleIdleSuspend();
    opts.onEnd?.();
  };
  const play = (samples: Float32Array) => {
    if (seq !== streamSeq || samples.length === 0) return;
    const buf = ac.createBuffer(1, samples.length, SAMPLE_RATE);
    buf.getChannelData(0).set(samples);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    const start = Math.max(ac.currentTime + 0.005, nextTime);
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
  if (cached) { cached.forEach(play); finished = true; done(); return true; }

  const abort = new AbortController();
  streamAbort = abort;
  const chunks: Float32Array[] = [];
  let gotAudio = false;
  void (async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      const res = await fetch("/api/tts", {
        method: "POST",
        signal: abort.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: clean, voice }),
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
      streamPlaying = false;
      emitSpeechError();
      opts.onError?.();
    }
  })();
  return true;
}

/** Speak one sentence with Gemini. Newest call always wins. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  if (!speechEnabled || speechSuppressed) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;
  return speakStreamed(clean, opts);
}
