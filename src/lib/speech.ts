// Single speech engine for the whole app.
//
// Hard-won rules this file encodes (newer WebKit — iOS 26/27, macOS 26+ — is
// far less forgiving than older Safari):
//
//  1. NEVER queue an utterance whose text has nothing speakable in it (a space,
//     a nbsp, punctuation only). On recent WebKit that utterance never ends:
//     `speechSynthesis.speaking` stays true forever and every later utterance
//     sits behind it, so the app goes completely silent with no error. The old
//     zero-volume "unlock" primer did exactly this.
//  2. Resolve a fresh voice for each utterance. WebKit can replace the objects
//     returned by getVoices(), so cached SpeechSynthesisVoice objects go stale.
//  3. Long text is unreliable; speak one short chunk at a time.
//  4. Never cancel and speak in the same tick. Current WebKit builds can let a
//     queued cancel clear the utterance submitted immediately after it.

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

/** Anything that a synthesizer can actually pronounce. */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

export function cleanForSpeech(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  try {
    return window.speechSynthesis;
  } catch {
    return null;
  }
}

/* -------------------------------- chunking ------------------------------- */

const CHUNK_MAX = 170;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_MAX) return [text];
  const parts: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) parts.push(t);
    buf = "";
  };
  // Words, keeping sentence punctuation attached so prosody survives.
  for (let word of text.split(" ")) {
    while (word.length > CHUNK_MAX) {
      push();
      parts.push(word.slice(0, CHUNK_MAX));
      word = word.slice(CHUNK_MAX);
    }
    if (buf && (buf.length + 1 + word.length > CHUNK_MAX)) push();
    buf = buf ? `${buf} ${word}` : word;
    // Prefer breaking right after a sentence end once we're reasonably full.
    if (buf.length > CHUNK_MAX * 0.6 && /[.!?]$/.test(buf)) push();
  }
  push();
  return parts.filter((p) => SPEAKABLE_RE.test(p));
}


/* -------------------------------- voices --------------------------------- */

function availableVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  try {
    return s.getVoices();
  } catch {
    return [];
  }
}

/** Always choose from the current list; never retain a voice object. */
function resolveVoice(): SpeechSynthesisVoice | null {
  const voices = availableVoices();
  if (voices.length === 0) return null;
  const language = (typeof navigator !== "undefined" ? navigator.language : "en-US").toLowerCase();
  const base = language.split("-")[0];
  return voices.find((voice) => voice.default)
    ?? voices.find((voice) => voice.localService && voice.lang.toLowerCase() === language)
    ?? voices.find((voice) => voice.localService && voice.lang.toLowerCase().split("-")[0] === base)
    ?? voices.find((voice) => voice.localService)
    ?? voices[0]
    ?? null;
}

/* -------------------------------- unlock --------------------------------- */

let unlocked = false;
let unlockArmed = false;

/** True once the engine has confirmed at least one utterance actually ran. */
export function speechUnlocked() {
  return unlocked;
}

/**
 * Arm gesture handling. All this does is warm the voice list and make sure the
 * queue isn't left paused — no primer utterance, because an unspeakable primer
 * is what wedges the queue on modern WebKit.
 */
export function installSpeechUnlock() {
  if (unlockArmed) return;
  const s = synth();
  if (!s) return;
  unlockArmed = true;
  const handler = () => {
    availableVoices();
    try {
      // A queue left in the paused state makes speak() a silent no-op.
      if (s.paused) s.resume();
    } catch {}
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("mousedown", handler, true);
  window.addEventListener("keydown", handler, true);
}

/* --------------------------------- speak --------------------------------- */

let generation = 0;
let watchdogs: number[] = [];
const liveUtterances = new Set<SpeechSynthesisUtterance>();

function debugSpeech(event: string, detail?: unknown) {
  if (import.meta.env.DEV) console.debug(`[speech] ${event}`, detail ?? "");
}

function clearWatchdogs() {
  for (const id of watchdogs) window.clearTimeout(id);
  watchdogs = [];
}

function later(fn: () => void, ms: number) {
  watchdogs.push(window.setTimeout(fn, ms));
}

export function cancelSpeech() {
  const s = synth();
  if (!s) return;
  generation += 1;
  clearWatchdogs();
  try {
    if (s.paused) s.resume();
  } catch {}
  try {
    s.cancel();
  } catch {}
  liveUtterances.clear();
}

export function isSpeaking(): boolean {
  const s = synth();
  if (!s) return false;
  try {
    return !!s.speaking;
  } catch {
    return false;
  }
}

/**
 * Speak `text`, replacing anything already in flight. Returns false when the
 * platform has no speech support or the text has nothing speakable in it.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const s = synth();
  if (!s) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  const chunks = chunkText(clean);
  if (chunks.length === 0) return false;

  const myGen = ++generation;
  clearWatchdogs();
  let started = false;
  let done = false;
  let retried = false;
  let chunkIndex = 0;

  const finish = (err: boolean) => {
    if (done || myGen !== generation) return;
    done = true;
    if (err) opts.onError?.();
    else opts.onEnd?.();
  };

  const build = (chunk: string, isLast: boolean) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.volume = 1;
    const voice = resolveVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onstart = () => {
      started = true;
      unlocked = true;
      debugSpeech("start", { chunk: chunkIndex + 1, voice: voice?.name ?? "system default" });
    };
    u.onend = () => {
      liveUtterances.delete(u);
      started = true;
      unlocked = true;
      if (myGen !== generation || done) return;
      if (isLast) finish(false);
      else {
        chunkIndex += 1;
        speakChunk();
      }
    };
    u.onerror = (event) => {
      liveUtterances.delete(u);
      debugSpeech("error", event.error);
      finish(true);
    };
    return u;
  };

  const speakChunk = () => {
    if (myGen !== generation || done) return;
    const chunk = chunks[chunkIndex];
    if (!chunk) return finish(false);
    const utterance = build(chunk, chunkIndex === chunks.length - 1);
    liveUtterances.add(utterance);
    try {
      s.speak(utterance);
      debugSpeech("queued", { chunk: chunkIndex + 1, pending: s.pending, speaking: s.speaking });
    } catch (error) {
      liveUtterances.delete(utterance);
      debugSpeech("throw", error);
      finish(true);
    }
  };

  const startWhenIdle = (attempt = 0) => {
    if (myGen !== generation || done) return;
    try { if (s.paused) s.resume(); } catch {}
    if ((s.speaking || s.pending) && attempt < 30) {
      later(() => startWhenIdle(attempt + 1), 16);
      return;
    }
    speakChunk();
  };

  // Preserve the direct user-gesture path when idle. When replacing active
  // audio, cancel exactly once and wait for WebKit to observe an idle queue.
  try {
    if (s.speaking || s.pending || s.paused) {
      if (s.paused) s.resume();
      s.cancel();
      liveUtterances.clear();
      startWhenIdle();
    } else {
      speakChunk();
    }
  } catch (error) {
    debugSpeech("startup throw", error);
    return false;
  }

  // If WebKit swallowed the first request, wait for a populated voice list and
  // retry once. The retry also gets a newly resolved voice object.
  later(() => {
    if (myGen !== generation || started || done) return;
    if (retried) return;
    retried = true;
    debugSpeech("retry", { voices: availableVoices().length, pending: s.pending, speaking: s.speaking });
    try {
      if (s.paused) s.resume();
      if (s.speaking || s.pending) s.cancel();
      liveUtterances.clear();
      chunkIndex = 0;
      startWhenIdle();
    } catch {}
  }, 900);

  return true;
}
