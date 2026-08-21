// Single speech engine for the whole app.
//
// Why this exists: newer WebKit builds (iOS 26/27, macOS 26+) are much stricter
// and much more fragile about the Web Speech API than they used to be:
//  - an utterance queued in the same tick as cancel() is frequently dropped,
//  - the queue can be left in a paused state, so speak() silently does nothing,
//  - a zero-volume "unlock" utterance no longer reliably counts as the
//    gesture-blessed first utterance,
//  - an utterance with no resolvable voice/lang can be dropped without error.
//
// So every speak goes through here: resume the queue, cancel politely, speak,
// then verify it actually started and retry once if it didn't.

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

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

/* ------------------------------- voices -------------------------------- */

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesBound = false;

function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = s.getVoices() ?? [];
  } catch {
    return null;
  }
  if (voices.length === 0) return null;
  const lang = (navigator.language || "en-US").toLowerCase();
  const base = lang.split("-")[0];
  const score = (v: SpeechSynthesisVoice) => {
    let n = 0;
    const vl = (v.lang || "").toLowerCase();
    if (vl === lang) n += 4;
    else if (vl.startsWith(base)) n += 3;
    if (v.default) n += 2;
    if (v.localService) n += 1;
    return n;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function ensureVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  if (!voicesBound) {
    voicesBound = true;
    try {
      s.addEventListener?.("voiceschanged", () => {
        cachedVoice = pickVoice();
      });
    } catch {}
  }
  if (!cachedVoice) cachedVoice = pickVoice();
  return cachedVoice;
}

/* ------------------------------- unlock -------------------------------- */

let unlocked = false;
let unlockArmed = false;

/** True once the engine has confirmed at least one utterance actually ran. */
export function speechUnlocked() {
  return unlocked;
}

function tryUnlock() {
  const s = synth();
  if (!s || unlocked) return;
  try {
    s.resume();
    const u = new SpeechSynthesisUtterance("\u00a0");
    // Audible-but-inaudible: a real (non-zero) volume is what newer WebKit
    // accepts as a genuine gesture-blessed utterance.
    u.volume = 0.01;
    u.rate = 2;
    const v = ensureVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.onstart = () => {
      unlocked = true;
    };
    u.onend = () => {
      unlocked = true;
    };
    s.speak(u);
    // Some builds never fire onstart for the primer; treat a queued+speaking
    // engine as unlocked too.
    window.setTimeout(() => {
      if (s.speaking || s.pending) unlocked = true;
    }, 120);
  } catch {}
}

/**
 * Arm the gesture-unlock. Stays armed (re-firing on every gesture) until the
 * engine confirms speech actually ran, instead of giving up after one attempt.
 */
export function installSpeechUnlock() {
  if (unlockArmed) return;
  const s = synth();
  if (!s) return;
  unlockArmed = true;
  const handler = () => {
    // Prime voices early — getVoices() is often empty on first paint.
    ensureVoice();
    if (unlocked) {
      window.removeEventListener("pointerdown", handler, true);
      window.removeEventListener("touchstart", handler, true);
      window.removeEventListener("mousedown", handler, true);
      window.removeEventListener("click", handler, true);
      window.removeEventListener("keydown", handler, true);
      return;
    }
    tryUnlock();
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("mousedown", handler, true);
  window.addEventListener("click", handler, true);
  window.addEventListener("keydown", handler, true);
}

/* -------------------------------- speak -------------------------------- */

let generation = 0;

export function cancelSpeech() {
  const s = synth();
  if (!s) return;
  generation += 1;
  try {
    s.resume();
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
 * Speak `text`, cancelling anything already in flight. Returns false when the
 * platform has no speech support or the text is empty after cleaning.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const s = synth();
  if (!s) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean) return false;

  const myGen = ++generation;
  let started = false;
  let finished = false;

  const build = () => {
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.volume = 1;
    const v = ensureVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = navigator.language || "en-US";
    }
    u.onstart = () => {
      started = true;
      unlocked = true;
    };
    u.onend = () => {
      finished = true;
      unlocked = true;
      if (myGen === generation) opts.onEnd?.();
    };
    u.onerror = () => {
      finished = true;
      if (myGen === generation) opts.onError?.();
    };
    return u;
  };

  try {
    // Clearing the queue and queueing in the same tick is exactly what newer
    // WebKit drops, so cancel first and always verify below.
    s.cancel();
    s.resume();
    s.speak(build());
  } catch {
    return false;
  }

  // Verification pass: if nothing ever started, the utterance was swallowed —
  // resume the queue and try once more.
  window.setTimeout(() => {
    if (myGen !== generation || finished || started) return;
    try {
      if (s.speaking) return;
      s.resume();
      if (s.speaking || s.pending) return;
      s.speak(build());
      // Final nudge: some builds queue but stay paused.
      window.setTimeout(() => {
        if (myGen !== generation || finished || started) return;
        try {
          s.resume();
        } catch {}
      }, 180);
    } catch {}
  }, 220);

  return true;
}
