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

// ---- shared in-flight downloads (one paid request per sentence, ever) ----
type Inflight = {
  chunks: Float32Array[];
  listeners: Set<(f: Float32Array) => void>;
  endListeners: Set<(ok: boolean) => void>;
  abort: AbortController;
  live: boolean;
};
const inflight = new Map<string, Inflight>();
/** Keys the app currently wants (current ±2). Downloads outside it may be cancelled. */
let wantedKeys = new Set<string>();
/** Do not keep hitting a provider that has already told us its quota is exhausted. */
let providerPausedUntil = 0;
const PROVIDER_PAUSE_KEY = "orby_tts_paused_until";

function currentProviderPause(): number {
  if (providerPausedUntil > Date.now()) return providerPausedUntil;
  if (typeof window === "undefined") return 0;
  try {
    const stored = Number(window.localStorage.getItem(PROVIDER_PAUSE_KEY));
    if (Number.isFinite(stored) && stored > Date.now()) {
      providerPausedUntil = stored;
      return stored;
    }
    window.localStorage.removeItem(PROVIDER_PAUSE_KEY);
  } catch {}
  return 0;
}

function pauseProviderUntil(timestamp: number) {
  providerPausedUntil = timestamp;
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PROVIDER_PAUSE_KEY, String(timestamp)); } catch {}
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function postTts(clean: string, v: string, signal: AbortSignal, live: boolean): Promise<Response> {
  if (currentProviderPause()) {
    return new Response("Speech error", { status: 429 });
  }
  const token = await getToken();
  if (!token) throw new Error("signed out");
  const req = () => fetch("/api/tts", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: clean, voice: v }),
  });
  let res = await req();
  if (res.status === 401) {
    try { await res.body?.cancel(); } catch {}
    accessToken = null;
    const { data } = await supabase.auth.refreshSession();
    accessToken = data.session?.access_token ?? null;
    if (!accessToken) return res;
    res = await fetch("/api/tts", {
      method: "POST", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ text: clean, voice: v }),
    });
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    pauseProviderUntil(Date.now() + (
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 60_000
    ));
  }
  return res;
}

function startDownload(key: string, clean: string, v: string, live: boolean): Inflight {
  const existing = inflight.get(key);
  if (existing) { if (live) existing.live = true; return existing; }
  const entry: Inflight = { chunks: [], listeners: new Set(), endListeners: new Set(), abort: new AbortController(), live };
  inflight.set(key, entry);
  const finish = (ok: boolean) => {
    if (inflight.get(key) === entry) inflight.delete(key);
    if (ok && entry.chunks.length) cachePut(key, entry.chunks);
    for (const l of entry.endListeners) { try { l(ok); } catch {} }
    entry.endListeners.clear(); entry.listeners.clear();
  };
  void (async () => {
    try {
      const res = await postTts(clean, v, entry.abort.signal, entry.live);
      if (!res.ok || !res.body) { console.warn("[orby-tts]", res.status); throw new Error(`tts ${res.status}`); }
      const reader = res.body.getReader();
      let carry: Uint8Array | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let bytes = value;
        if (carry) {
          const m = new Uint8Array(carry.length + bytes.length);
          m.set(carry); m.set(bytes, carry.length); bytes = m; carry = null;
        }
        if (bytes.length % 2) { carry = bytes.slice(-1); bytes = bytes.slice(0, -1); }
        const f = pcmToFloat(bytes);
        if (f.length) { entry.chunks.push(f); for (const l of entry.listeners) { try { l(f); } catch {} } }
      }
      finish(entry.chunks.length > 0);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") console.warn("[orby-tts] download failed");
      finish(false);
    }
  })();
  return entry;
}

// ---- audio ----
let ctx: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];
let streamPlaying = false;
let streamSeq = 0;
let liveDetach: (() => void) | null = null;
let liveKey: string | null = null;

function suspendCtx() {
  if (ctx && ctx.state === "running") { try { void ctx.suspend(); } catch {} }
}

/** Created lazily on the first read; woken (or replaced if stuck) inside every press. */
function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  requestIosMixableSession();
  const st = ctx?.state as string | undefined;
  if (ctx && (st === "closed" || st === "interrupted")) { try { void ctx.close(); } catch {} ctx = null; }
  if (!ctx) { try { ctx = new Ctor(); } catch { return null; } }
  if (ctx && ctx.state !== "running") { try { void ctx.resume(); } catch {} }
  return ctx;
}

let listenersAttached = false;
function attachListeners() {
  if (listenersAttached || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  listenersAttached = true;
  wireAuth();
  // Leaving the app: stop speaking and quietly pause. Never touch the audio mode.
  const onHide = () => { cancelSpeech(); cancelPrewarm(); suspendCtx(); };
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
  liveDetach?.(); liveDetach = null;
  // Cancel the previous live download only if it is no longer wanted.
  if (liveKey && !wantedKeys.has(liveKey)) {
    const e = inflight.get(liveKey);
    if (e) { e.abort.abort(); inflight.delete(liveKey); }
  }
  liveKey = null;
  for (const s of sources) { try { s.onended = null; s.stop(); } catch {} }
  sources = [];
  streamPlaying = false;
}

export function cancelSpeech() { stopStream(); }
export function isSpeaking() { return streamPlaying; }
export function resetSpeechCaches() { cancelSpeech(); cancelPrewarm(); cache.clear(); }

// ---- prewarm (fills the cache without playing) ----
let prewarmGen = 0;
let liveGate: Promise<void> | null = null;
export function cancelPrewarm() {
  prewarmGen += 1;
  for (const [k, e] of inflight) {
    if (!e.live && !wantedKeys.has(k)) { e.abort.abort(); inflight.delete(k); }
  }
}
/** Voice switched: drop old-voice preloads (the app re-preloads in the new voice). */
export function onVoiceChanged() {
  wantedKeys = new Set();
  cancelPrewarm();
}
/** Preload exactly these sentences (the app passes current ±2). */
export function prewarmSpeech(texts: string[]) {
  const v = voice;
  const next: { key: string; clean: string; v: string }[] = [];
  const keys = new Set<string>();
  for (const t of texts) {
    const c = cleanForSpeech(t ?? "");
    if (!c || !SPEAKABLE_RE.test(c)) continue;
    const key = `${v}|${c}`;
    if (keys.has(key)) continue;
    keys.add(key);
    if (!cache.has(key) && !inflight.has(key)) next.push({ key, clean: c, v });
  }
  const gen = ++prewarmGen;
  wantedKeys = keys;
  for (const [k, e] of inflight) {
    if (!e.live && !wantedKeys.has(k)) { e.abort.abort(); inflight.delete(k); }
  }
  if (!speechEnabled || speechSuppressed || typeof fetch !== "function") return;
  void runPrewarm(next, gen);
}
async function runPrewarm(items: { key: string; clean: string; v: string }[], gen: number) {
  await sleep(250);
  for (const item of items) {
    if (gen !== prewarmGen || currentProviderPause()) return;
    if (liveGate) await liveGate;
    if (gen !== prewarmGen || cache.has(item.key) || !wantedKeys.has(item.key)) continue;
    const e = startDownload(item.key, item.clean, item.v, false);
    await new Promise<void>((resolve) => {
      if (!inflight.has(item.key)) resolve();
      else e.endListeners.add(() => resolve());
    });
  }
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

  // Join an existing download (preload or earlier press) or start one.
  liveKey = key;
  const entry = startDownload(key, clean, voice, true);
  let releaseGate: () => void = () => {};
  liveGate = new Promise<void>((r) => { releaseGate = () => { r(); if (liveGate === gate) liveGate = null; }; });
  const gate = liveGate;
  entry.chunks.forEach(play);
  const onChunk = (f: Float32Array) => { releaseGate(); play(f); };
  const onEnd = (ok: boolean) => {
    releaseGate();
    if (seq !== streamSeq) return;
    liveDetach = null;
    if (ok || entry.chunks.length) { finished = true; done(); return; }
    streamPlaying = false;
    emitSpeechError();
    opts.onError?.();
  };
  if (entry.chunks.length) releaseGate();
  entry.listeners.add(onChunk);
  entry.endListeners.add(onEnd);
  liveDetach = () => { entry.listeners.delete(onChunk); entry.endListeners.delete(onEnd); releaseGate(); };
  return true;
}

/** Speak one sentence with Gemini. Newest call always wins. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  if (!speechEnabled || speechSuppressed) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;
  return speakStreamed(clean, opts);
}
