// Client-side manager for the on-device voice. Generates sentence audio in a
// worker, caches recent clips, and prefetches upcoming sentences for free.

export type LocalClip = { pcm: Float32Array; rate: number };

export const LOCAL_VOICES = [
  { id: "af_heart", label: "Heart (warm)" },
  { id: "af_bella", label: "Bella (bright)" },
  { id: "am_michael", label: "Michael (calm)" },
  { id: "am_fenrir", label: "Fenrir (deep)" },
] as const;

const VOICE_KEY = "orby-local-voice";
const CACHE_LIMIT = 40;

let worker: Worker | null = null;
let state: "idle" | "loading" | "ready" | "failed" = "idle";
let seq = 0;
const pending = new Map<number, { resolve: (c: LocalClip) => void; reject: (e: Error) => void }>();
const cache = new Map<string, Promise<LocalClip>>();

export function getLocalVoice(): string {
  try {
    return localStorage.getItem(VOICE_KEY) || "af_heart";
  } catch {
    return "af_heart";
  }
}

export function setLocalVoice(id: string) {
  try {
    localStorage.setItem(VOICE_KEY, id);
  } catch {}
}

function supported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

function ensureWorker(): Worker | null {
  if (worker || !supported() || state === "failed") return worker;
  try {
    worker = new Worker(new URL("./tts-local.worker.ts", import.meta.url), { type: "module" });
  } catch {
    state = "failed";
    return null;
  }
  worker.onmessage = (event) => {
    const m = event.data;
    if (m.type === "ready") state = "ready";
    else if (m.type === "load-failed") state = "failed";
    else if (m.type === "audio") {
      pending.get(m.id)?.resolve({ pcm: m.pcm, rate: m.rate });
      pending.delete(m.id);
    } else if (m.type === "error") {
      pending.get(m.id)?.reject(new Error(m.message));
      pending.delete(m.id);
    }
  };
  worker.onerror = () => {
    state = "failed";
    for (const p of pending.values()) p.reject(new Error("voice engine crashed"));
    pending.clear();
  };
  return worker;
}

/** Start downloading the voice (once; the browser caches the files). */
export function warmLocalVoice() {
  if (state !== "idle") return;
  const w = ensureWorker();
  if (!w) return;
  state = "loading";
  w.postMessage({ type: "load" });
}

export function isLocalVoiceReady(): boolean {
  return state === "ready";
}

function key(text: string, voice: string, speed: number) {
  return `${voice}|${speed}|${text}`;
}

export function hasLocalClip(text: string, speed = 1): boolean {
  return cache.has(key(text, getLocalVoice(), speed));
}

export function generateLocalClip(text: string, speed = 1): Promise<LocalClip> {
  const voice = getLocalVoice();
  const k = key(text, voice, speed);
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k);
    cache.set(k, hit);
    return hit;
  }
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error("unsupported"));
  const id = ++seq;
  const p = new Promise<LocalClip>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: "gen", id, text, voice, speed });
  });
  p.catch(() => cache.delete(k));
  cache.set(k, p);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return p;
}

/** Prepare upcoming sentences ahead of time. Only runs once the voice is ready. */
export function prefetchLocalClips(texts: string[], speed = 1) {
  if (state !== "ready") return;
  for (const t of texts) if (t) void generateLocalClip(t, speed).catch(() => {});
}
