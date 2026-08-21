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
//  2. Do NOT assign `utterance.voice` or `utterance.lang` unless we truly have
//     to. Leaving them alone makes WebKit use the system voice — i.e. the voice
//     the user picked in Settings > Accessibility > Spoken Content — which is
//     what we want. Assigning a voice object from a getVoices() list that has
//     since been refreshed makes WebKit drop the utterance silently.
//  3. Long text is unreliable; speak in short chunks queued back to back.
//  4. Verify. If nothing started shortly after speak(), the utterance was
//     swallowed: clear the queue and speak once more.

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
  // Split on sentence ends first, then on clause boundaries, then hard-wrap.
  const parts: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) parts.push(t);
    buf = "";
  };
  const pieces = text.split(/(?<=[.!?;:,])\s+|(?<=\s)(?=\S)/);
  for (const p of pieces) {
    if ((buf + p).length > CHUNK_MAX && buf.trim()) push();
    buf += p;
    if (buf.length >= CHUNK_MAX) {
      // A single very long token — hard-wrap it.
      while (buf.length > CHUNK_MAX) {
        parts.push(buf.slice(0, CHUNK_MAX));
        buf = buf.slice(CHUNK_MAX);
      }
    }
  }
  push();
  return parts.filter((p) => SPEAKABLE_RE.test(p));
}

/* -------------------------------- voices --------------------------------- */

let voicesWarmed = false;

/**
 * Touch getVoices() once so WebKit populates its list. We deliberately do NOT
 * pick or assign a voice: the default (unset) voice is the one the user chose
 * in their device's spoken-content settings.
 */
function warmVoices() {
  if (voicesWarmed) return;
  const s = synth();
  if (!s) return;
  try {
    s.getVoices();
    voicesWarmed = true;
  } catch {}
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
    warmVoices();
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

  const finish = (err: boolean) => {
    if (done || myGen !== generation) return;
    done = true;
    if (err) opts.onError?.();
    else opts.onEnd?.();
  };

  const build = (chunk: string, isFirst: boolean, isLast: boolean) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.volume = 1;
    // Intentionally no u.voice / u.lang — see rule 2 at the top of this file.
    if (isFirst) {
      u.onstart = () => {
        started = true;
        unlocked = true;
      };
    }
    if (isLast) {
      u.onend = () => {
        started = true;
        unlocked = true;
        finish(false);
      };
      u.onerror = () => finish(true);
    } else {
      u.onstart = u.onstart ?? null;
    }
    return u;
  };

  const queueAll = () => {
    chunks.forEach((c, i) => {
      try {
        s.speak(build(c, i === 0, i === chunks.length - 1));
      } catch {}
    });
  };

  try {
    // cancel() also clears a wedged queue left over from an utterance that
    // never fired onend — the usual reason for total silence.
    s.cancel();
    if (s.paused) s.resume();
    queueAll();
  } catch {
    return false;
  }

  // Verification: if nothing ever started, the batch was swallowed. Clear and
  // re-queue exactly once, then keep nudging a paused queue.
  later(() => {
    if (myGen !== generation || started || done) return;
    try {
      if (s.paused) s.resume();
      if (s.speaking) return;
      s.cancel();
      queueAll();
    } catch {}
  }, 260);

  later(() => {
    if (myGen !== generation || started || done) return;
    try {
      if (s.paused) s.resume();
    } catch {}
  }, 700);

  return true;
}
