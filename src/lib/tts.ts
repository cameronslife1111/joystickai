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

export type VoiceOption = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

let seq = 0;
let voice: SpeechSynthesisVoice | null = null;
let voicesReady = false;
let listenerBound = false;
let lastCancelAt = 0;
let audioUnlocked = false;
const waiting: (() => void)[] = [];
const voiceSubscribers = new Set<(voices: VoiceOption[]) => void>();
const VOICE_STORAGE_KEY = "orby_tts_voice";

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

function pickVoice(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!list.length) return null;
  const saved = readSavedVoice();
  if (saved) {
    const exact = list.find((v) => v.voiceURI === saved.voiceURI);
    if (exact) return exact;
    const fallback = list.find((v) => v.name === saved.name && v.lang === saved.lang);
    if (fallback) return fallback;
  }
  const en = list.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length ? en : list;
  return pool.find((v) => v.localService && v.default)
    ?? pool.find((v) => v.localService)
    ?? pool.find((v) => v.default)
    ?? pool[0]
    ?? null;
}

function readSavedVoice(): { voiceURI: string; name: string; lang: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VOICE_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed.voiceURI !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function publicVoices(list: SpeechSynthesisVoice[]): VoiceOption[] {
  return list
    .filter((v) => v.lang?.toLowerCase().startsWith("en"))
    .map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
    }))
    .sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
}

function notifyVoiceSubscribers(list: SpeechSynthesisVoice[]) {
  const available = publicVoices(list);
  voiceSubscribers.forEach((subscriber) => subscriber(available));
}

function resolveVoice(): boolean {
  const s = synth();
  if (!s) return false;
  const list = s.getVoices();
  if (!list.length) return false;
  voice = pickVoice(list);
  voicesReady = true;
  notifyVoiceSubscribers(list);
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
  resolveVoice();
}

/**
 * Open WebKit's speech audio session while still inside a trusted user gesture.
 * The real sentence may be selected only after an awaited index save, by which
 * point iOS no longer considers it gesture-initiated.
 */
export function unlockSpeech() {
  const s = synth();
  if (!s || audioUnlocked) return;
  bindVoiceListener();
  try {
    s.resume();
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    primer.rate = 10;
    if (voice) {
      primer.voice = voice;
      if (voice.lang) primer.lang = voice.lang;
    }
    s.speak(primer);
    audioUnlocked = true;
  } catch {}
}

export function getAvailableVoices(): VoiceOption[] {
  bindVoiceListener();
  const s = synth();
  if (!s) return [];
  resolveVoice();
  return publicVoices(s.getVoices());
}

export function getSelectedVoiceURI(): string | null {
  return voice?.voiceURI ?? readSavedVoice()?.voiceURI ?? null;
}

export function selectVoice(voiceURI: string): boolean {
  const s = synth();
  if (!s) return false;
  const selected = s.getVoices().find((item) => item.voiceURI === voiceURI);
  if (!selected) return false;
  voice = selected;
  voicesReady = true;
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify({
      voiceURI: selected.voiceURI,
      name: selected.name,
      lang: selected.lang,
    }));
  } catch {}
  return true;
}

export function subscribeToVoices(subscriber: (voices: VoiceOption[]) => void) {
  voiceSubscribers.add(subscriber);
  subscriber(getAvailableVoices());
  return () => {
    voiceSubscribers.delete(subscriber);
  };
}

/** Stop anything in flight and invalidate queued speech. */
export function cancelSpeech() {
  seq += 1;
  const s = synth();
  if (!s) return;
  try {
    if (s.speaking || s.pending) {
      lastCancelAt = Date.now();
      s.cancel();
    }
  } catch {}
}

export function speakText(
  text: string,
  isCurrent: Guard = () => true,
  opts: { onEnd?: () => void } = {},
) {
  const s = synth();
  if (!s || !text) return;
  bindVoiceListener();

  const mySeq = ++seq;
  const alive = () => mySeq === seq && isCurrent();

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    opts.onEnd?.();
  };

  const utter = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = finish;
    u.onerror = finish;
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
      finish();
      return;
    }
    // WebKit sometimes drops the utterance outright — re-issue once.
    window.setTimeout(() => {
      if (!alive() || ended) return;
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
        lastCancelAt = Date.now();
        s.cancel();
      } catch {}
    }
    const elapsed = Date.now() - lastCancelAt;
    const delay = Math.max(0, 90 - elapsed);
    if (delay > 0) {
      window.setTimeout(run, delay);
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
