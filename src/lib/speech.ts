// Shared browser speech engine. Keep this deliberately close to the Web Speech
// API so speech stays on-device and uses a voice exposed by the browser.

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

function isIosWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(userAgent)
    || (userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/* -------------------------------- chunking ------------------------------- */

const CHUNK_MAX = 170;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_MAX) return [text];
  const chunks: string[] = [];
  let buffer = "";
  const push = () => {
    const value = buffer.trim();
    if (value && SPEAKABLE_RE.test(value)) chunks.push(value);
    buffer = "";
  };

  for (let word of text.split(" ")) {
    while (word.length > CHUNK_MAX) {
      push();
      chunks.push(word.slice(0, CHUNK_MAX));
      word = word.slice(CHUNK_MAX);
    }
    if (buffer && buffer.length + word.length + 1 > CHUNK_MAX) push();
    buffer = buffer ? `${buffer} ${word}` : word;
    if (buffer.length > CHUNK_MAX * 0.6 && /[.!?]$/.test(buffer)) push();
  }
  push();
  return chunks;
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

/** Resolve a fresh object each time because WebKit can replace voice objects. */
function resolveVoice(): SpeechSynthesisVoice | null {
  const voices = availableVoices();
  if (voices.length === 0) return null;
  const language = (typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US").toLowerCase();
  const baseLanguage = language.split("-")[0];
  return voices.find((voice) => voice.default)
    ?? voices.find((voice) => voice.localService && voice.lang.toLowerCase() === language)
    ?? voices.find((voice) => voice.localService && voice.lang.toLowerCase().split("-")[0] === baseLanguage)
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
 * iOS (Safari *and* Chrome/Edge on iOS, which all use WebKit) will silently
 * drop every utterance until speechSynthesis.speak() has been called once
 * synchronously inside a real user gesture. Resuming the queue is not enough —
 * an actual utterance must be submitted. So on the first gesture we submit a
 * near-silent real utterance, and we keep the listeners armed until the engine
 * confirms it ran.
 */
export function installSpeechUnlock() {
  if (unlockArmed) return;
  const s = synth();
  if (!s) return;
  unlockArmed = true;

  const handler = () => {
    // Never enqueue a silent/whitespace primer. Recent WebKit can leave such
    // an utterance permanently "speaking", blocking every real sentence.
    availableVoices();
    try {
      if (s.paused) s.resume();
    } catch {}
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      cancelSpeech();
      return;
    }
    handler();
  };

  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("mousedown", handler, true);
  window.addEventListener("keydown", handler, true);
  window.addEventListener("focus", handler);
  window.addEventListener("pageshow", handler);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", cancelSpeech);
}


/* --------------------------------- speak --------------------------------- */

let generation = 0;
const liveUtterances = new Set<SpeechSynthesisUtterance>();
const pendingTimers = new Set<number>();
let audibleSpeaking = false;

function debugSpeech(event: string, detail?: unknown) {
  if (import.meta.env.DEV) console.debug(`[speech] ${event}`, detail ?? "");
}

function later(callback: () => void, delay: number) {
  const timer = window.setTimeout(() => {
    pendingTimers.delete(timer);
    callback();
  }, delay);
  pendingTimers.add(timer);
}

function clearTimers() {
  for (const timer of pendingTimers) window.clearTimeout(timer);
  pendingTimers.clear();
}

export function cancelSpeech() {
  const s = synth();
  if (!s) return;
  generation += 1;
  audibleSpeaking = false;
  clearTimers();
  try {
    if (s.paused) s.resume();
  } catch {}
  try {
    s.cancel();
  } catch {}
  // Keep cancelled utterances alive briefly. Some WebKit versions dispatch the
  // cancellation event asynchronously and can otherwise lose the JS wrapper.
  const cancelled = [...liveUtterances];
  window.setTimeout(() => {
    for (const utterance of cancelled) liveUtterances.delete(utterance);
  }, 500);
}

export function isSpeaking(): boolean {
  return audibleSpeaking;
}

/** Give iOS WebKit the duration of the swipe to settle a cancelled queue. */
export function prepareSpeechGesture() {
  if (!isIosWebKit()) return;
  const s = synth();
  if (!s) return;
  try {
    if (s.speaking || s.pending || s.paused) cancelSpeech();
  } catch {}
}

/**
 * Speak the newest text using the browser/device default voice. Idle speech is
 * submitted synchronously (important for mobile user activation). Replacing
 * active speech waits for cancel() to settle instead of racing a new utterance
 * into the old queue.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const s = synth();
  if (!s) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  const chunks = chunkText(clean);
  if (chunks.length === 0) return false;

  const myGen = ++generation;
  clearTimers();

  let started = false;
  let finished = false;
  let retried = false;
  let chunkIndex = 0;
  let removeVoicesListener: (() => void) | null = null;

  const finish = (failed: boolean) => {
    if (finished || myGen !== generation) return;
    finished = true;
    audibleSpeaking = false;
    removeVoicesListener?.();
    removeVoicesListener = null;
    if (failed) opts.onError?.();
    else opts.onEnd?.();
  };

  const submit = () => {
    if (myGen !== generation || finished) return;
    const chunk = chunks[chunkIndex];
    if (!chunk) {
      finish(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = opts.rate ?? 1;
    utterance.pitch = opts.pitch ?? 1;
    utterance.volume = 1;
    const voice = resolveVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.onstart = () => {
      started = true;
      unlocked = true;
      audibleSpeaking = true;
      debugSpeech("start", { chunk: chunkIndex + 1, voice: voice?.name ?? "system default" });
    };
    utterance.onend = () => {
      liveUtterances.delete(utterance);
      started = true;
      unlocked = true;
      if (myGen !== generation || finished) return;
      if (chunkIndex >= chunks.length - 1) finish(false);
      else {
        chunkIndex += 1;
        submit();
      }
    };
    utterance.onerror = (event) => {
      liveUtterances.delete(utterance);
      audibleSpeaking = false;
      debugSpeech("error", event.error);
      if (event.error === "canceled" || event.error === "interrupted") return;
      finish(true);
    };

    liveUtterances.add(utterance);
    try {
      if (s.paused) s.resume();
      s.speak(utterance);
      debugSpeech("queued", { chunk: chunkIndex + 1, pending: s.pending, speaking: s.speaking });
    } catch (error) {
      liveUtterances.delete(utterance);
      debugSpeech("throw", error);
      finish(true);
      return;
    }

    // Browsers sometimes drop an utterance without throwing or firing error.
    // Retry once, only if the queue is fully idle and this is still the newest
    // request. getVoices() refreshes Chrome's lazy voice registry without
    // overriding the user's configured default voice.
    later(() => {
      if (myGen !== generation || started || finished || retried) return;
      if (s.speaking || s.pending) return;
      if (isIosWebKit()) {
        finish(true);
        return;
      }
      retried = true;
      try {
        s.getVoices();
      } catch {}
      debugSpeech("retry", "utterance did not start");
      submit();
    }, 900);
  };

  const submitWhenIdle = (attempt = 0) => {
    if (myGen !== generation || finished) return;
    try {
      if (s.paused) s.resume();
    } catch {}
    if ((s.speaking || s.pending) && attempt < 30) {
      later(() => submitWhenIdle(attempt + 1), 16);
      return;
    }
    submit();
  };

  if (availableVoices().length === 0 && typeof s.addEventListener === "function") {
    const onVoicesChanged = () => {
      if (myGen !== generation || started || finished || retried || s.speaking || s.pending) return;
      retried = true;
      removeVoicesListener?.();
      removeVoicesListener = null;
      submitWhenIdle();
    };
    s.addEventListener("voiceschanged", onVoicesChanged);
    removeVoicesListener = () => s.removeEventListener("voiceschanged", onVoicesChanged);
  }

  try {
    if (s.paused) s.resume();
    if (s.speaking || s.pending) {
      s.cancel();
      // Never cancel and speak in the same turn. WebKit can apply the pending
      // cancel to the newly submitted utterance and silently discard it.
      later(() => submitWhenIdle(), 16);
    } else {
      submit();
    }

  } catch (error) {
    debugSpeech("replace failed", error);
    opts.onError?.();
    return false;
  }
  return true;
}
