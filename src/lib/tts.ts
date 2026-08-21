// Robust Web Speech wrapper.
//
// Two WebKit behaviours make the naive `cancel(); speak(u)` pattern silently
// drop audio on recent iOS/macOS builds:
//   1. Cancelling the queue also swallows the *next* utterance handed over in
//      the same tick (WebKit bug — clear() removes following speak()s).
//   2. The queue can be left paused after a cancel, so speak() never starts.
// So: only cancel when something is actually speaking, hand the utterance over
// on a later tick, resume() first, and re-issue once if the engine ate it.
// A voice is also resolved explicitly, because desktop Safari can start with an
// empty voice list and drop utterances until `voiceschanged` fires.

type Guard = () => boolean;

let seq = 0;
let voice: SpeechSynthesisVoice | null = null;
let voicesReady = false;
let listenerBound = false;
const waiting: (() => void)[] = [];

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

function pickVoice(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!list.length) return null;
  const en = list.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length ? en : list;
  return pool.find((v) => v.localService && v.default)
    ?? pool.find((v) => v.localService)
    ?? pool.find((v) => v.default)
    ?? pool[0]
    ?? null;
}

function resolveVoice(): boolean {
  const s = synth();
  if (!s) return false;
  const list = s.getVoices();
  if (!list.length) return false;
  voice = pickVoice(list);
  voicesReady = true;
  return true;
}

function bindVoiceListener() {
  const s = synth();
  if (!s || listenerBound) return;
  listenerBound = true;
  const onChange = () => {
    if (resolveVoice()) {
      const pending = waiting.splice(0, waiting.length);
      pending.forEach((fn) => fn());
    }
  };
  try {
    s.addEventListener("voiceschanged", onChange);
  } catch {
    (s as any).onvoiceschanged = onChange;
  }
  resolveVoice();
}

/** Warm the voice list early (safe to call on mount). */
export function primeVoices() {
  bindVoiceListener();
}

/** Stop anything in flight and invalidate queued speech. */
export function cancelSpeech() {
  seq += 1;
  const s = synth();
  if (!s) return;
  try {
    if (s.speaking || s.pending) s.cancel();
  } catch {}
}

export function speakText(text: string, isCurrent: Guard = () => true) {
  const s = synth();
  if (!s || !text) return;
  bindVoiceListener();

  const mySeq = ++seq;
  const alive = () => mySeq === seq && isCurrent();

  const utter = () => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      if (voice.lang) u.lang = voice.lang;
    }
    u.rate = 1;
    u.pitch = 1;
    return u;
  };

  const run = () => {
    if (!alive()) return;
    try {
      s.resume();
    } catch {}
    try {
      s.speak(utter());
    } catch {
      return;
    }
    // WebKit sometimes drops the utterance outright — re-issue once.
    window.setTimeout(() => {
      if (!alive()) return;
      if (s.speaking || s.pending) return;
      try {
        s.resume();
        s.speak(utter());
      } catch {}
    }, 250);
  };

  const start = () => {
    if (s.speaking || s.pending) {
      try {
        s.cancel();
      } catch {}
      window.setTimeout(run, 70);
    } else {
      run();
    }
  };

  if (voicesReady || resolveVoice()) {
    start();
  } else {
    // Hold the first utterance until the voice list arrives, with a fallback so
    // a browser that never fires voiceschanged still speaks.
    let fired = false;
    const once = () => {
      if (fired) return;
      fired = true;
      start();
    };
    waiting.push(once);
    window.setTimeout(once, 800);
  }
}
