// Client-side manager for the on-device voice. Generates sentence audio in a
// worker one clip at a time through a priority queue: the sentence the user is
// on always jumps the line, then upcoming/previous/pinned sentences follow.

export type LocalClip = { pcm: Float32Array; rate: number };

export const LOCAL_VOICES = [
  { id: "af_heart", label: "Heart (warm)" },
  { id: "af_bella", label: "Bella (bright)" },
  { id: "af_nicole", label: "Nicole (soft)" },
  { id: "af_sarah", label: "Sarah (clear)" },
  { id: "bf_emma", label: "Emma (British)" },
  { id: "am_michael", label: "Michael (calm)" },
  { id: "am_fenrir", label: "Fenrir (deep)" },
  { id: "bm_george", label: "George (British)" },
] as const;

const VOICE_KEY = "orby-local-voice";
const CACHE_LIMIT = 160;

type Job = { key: string; text: string; voice: string; speed: number; resolve: (c: LocalClip) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let state: "idle" | "loading" | "ready" | "failed" = "idle";
let seq = 0;
let inflight: { id: number; job: Job } | null = null;
const queue: Job[] = [];
const cache = new Map<string, Promise<LocalClip>>();
const done = new Set<string>();
const voiceListeners = new Set<() => void>();

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
  queue.length = 0;
  for (const l of voiceListeners) l();
}

export function onLocalVoiceChange(fn: () => void) {
  voiceListeners.add(fn);
  return () => voiceListeners.delete(fn);
}

function supported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

function pump() {
  if (inflight || state !== "ready" || !worker) return;
  const job = queue.shift();
  if (!job) return;
  const id = ++seq;
  inflight = { id, job };
  worker.postMessage({ type: "gen", id, text: job.text, voice: job.voice, speed: job.speed });
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
    if (m.type === "ready") {
      state = "ready";
      pump();
    } else if (m.type === "load-failed") {
      state = "failed";
      for (const j of queue) j.reject(new Error("voice failed to load"));
      queue.length = 0;
    } else if ((m.type === "audio" || m.type === "error") && inflight?.id === m.id) {
      const { job } = inflight;
      inflight = null;
      if (m.type === "audio") {
        done.add(job.key);
        job.resolve({ pcm: m.pcm, rate: m.rate });
      } else job.reject(new Error(m.message));
      pump();
    }
  };
  worker.onerror = () => {
    state = "failed";
    inflight?.job.reject(new Error("voice engine crashed"));
    inflight = null;
    for (const j of queue) j.reject(new Error("voice engine crashed"));
    queue.length = 0;
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
  return done.has(key(text, getLocalVoice(), speed));
}

function trim() {
  while (cache.size > CACHE_LIMIT) {
    const k = cache.keys().next().value as string;
    if (queue.some((j) => j.key === k) || inflight?.job.key === k) break;
    cache.delete(k);
    done.delete(k);
  }
}

function request(text: string, speed: number, urgent: boolean): Promise<LocalClip> {
  const voice = getLocalVoice();
  const k = key(text, voice, speed);
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k);
    cache.set(k, hit);
    if (urgent) {
      // Still waiting in line? Move it to the very front.
      const i = queue.findIndex((j) => j.key === k);
      if (i > 0) queue.unshift(...queue.splice(i, 1));
    }
    return hit;
  }
  if (!ensureWorker()) return Promise.reject(new Error("unsupported"));
  const p = new Promise<LocalClip>((resolve, reject) => {
    const job: Job = { key: k, text, voice, speed, resolve, reject };
    if (urgent) queue.unshift(job);
    else queue.push(job);
  });
  p.catch(() => {
    cache.delete(k);
    done.delete(k);
  });
  cache.set(k, p);
  trim();
  pump();
  return p;
}

/** The sentence the user is on right now: always generated next. */
export function generateLocalClip(text: string, speed = 1): Promise<LocalClip> {
  return request(text, speed, true);
}

function clean(raw: string) {
  return raw.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * Replace the look-ahead plan. `texts` is in priority order. Waiting clips that
 * are no longer in the plan are dropped so the queue follows the user's swipes.
 */
export function prefetchLocalClips(texts: string[], speed = 1) {
  if (state !== "ready") return;
  const voice = getLocalVoice();
  const wanted = new Set<string>();
  const ordered: string[] = [];
  for (const raw of texts) {
    const t = clean(raw);
    if (!t) continue;
    const k = key(t, voice, speed);
    if (wanted.has(k)) continue;
    wanted.add(k);
    ordered.push(t);
  }
  // Drop stale waiting jobs so the engine follows the user's position.
  for (let i = queue.length - 1; i >= 0; i--) {
    const j = queue[i];
    if (!wanted.has(j.key)) {
      queue.splice(i, 1);
      cache.delete(j.key);
      j.reject(new Error("skipped"));
    }
  }
  // Re-order the remaining queue to match the new priority.
  const rank = new Map(ordered.map((t, i) => [key(t, voice, speed), i]));
  queue.sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9));
  for (const t of ordered) void request(t, speed, false).catch(() => {});
  queue.sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9));
}
