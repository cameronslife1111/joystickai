// Shared browser speech engine. Keep this deliberately close to the Web Speech
// API: the browser owns voice selection, so Safari can use the device's current
// default voice and other browsers can use their own default voice.

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

/* -------------------------------- unlock --------------------------------- */

let unlocked = false;
let unlockArmed = false;

/** True once the engine has confirmed at least one utterance actually ran. */
export function speechUnlocked() {
  return unlocked;
}

/**
 * Keep a paused browser queue resumable after any real user interaction.
 */
export function installSpeechUnlock() {
  if (unlockArmed) return;
  const s = synth();
  if (!s) return;
  unlockArmed = true;
  const handler = () => {
    // Chrome can populate its voices asynchronously. Warming the list here is
    // harmless when it is already ready and avoids a cold first utterance.
    try {
      s.getVoices();
    } catch {}
    try {
      if (s.paused) s.resume();
    } catch {}
  };
  const resetWhenHidden = () => {
    if (document.visibilityState !== "hidden") return;
    cancelSpeech();
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("mousedown", handler, true);
  window.addEventListener("keydown", handler, true);
  document.addEventListener("visibilitychange", resetWhenHidden);
  window.addEventListener("pagehide", cancelSpeech);
}

/* --------------------------------- speak --------------------------------- */

let generation = 0;
const liveUtterances = new Set<SpeechSynthesisUtterance>();
let pendingTimer: number | null = null;

function debugSpeech(event: string, detail?: unknown) {
  if (import.meta.env.DEV) console.debug(`[speech] ${event}`, detail ?? "");
}

export function cancelSpeech() {
  const s = synth();
  if (!s) return;
  generation += 1;
  if (pendingTimer != null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  try {
    if (s.paused) s.resume();
  } catch {}
  try {
    s.cancel();
  } catch {}
  // Keep cancelled utterances alive briefly. Some WebKit versions dispatch the
  // cancellation event asynchronously and can otherwise lose the JS wrapper.
  window.setTimeout(() => liveUtterances.clear(), 500);
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

  const myGen = ++generation;
  if (pendingTimer != null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  let started = false;
  let finished = false;
  let retried = false;

  const submit = () => {
    if (myGen !== generation || finished) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = opts.rate ?? 1;
    utterance.pitch = opts.pitch ?? 1;
    utterance.volume = 1;
    // Deliberately leave voice and lang unset. That is the only portable way
    // to honor the voice selected by the browser or operating system.
    utterance.onstart = () => {
      started = true;
      unlocked = true;
      debugSpeech("start", "browser default voice");
    };
    utterance.onend = () => {
      liveUtterances.delete(utterance);
      finished = true;
      unlocked = true;
      if (myGen === generation) opts.onEnd?.();
    };
    utterance.onerror = (event) => {
      liveUtterances.delete(utterance);
      debugSpeech("error", event.error);
      if (event.error === "canceled" || event.error === "interrupted") return;
      finished = true;
      if (myGen === generation) opts.onError?.();
    };

    liveUtterances.add(utterance);
    try {
      if (s.paused) s.resume();
      s.speak(utterance);
      debugSpeech("queued", { pending: s.pending, speaking: s.speaking });
    } catch (error) {
      liveUtterances.delete(utterance);
      finished = true;
      debugSpeech("throw", error);
      if (myGen === generation) opts.onError?.();
      return;
    }

    // Browsers sometimes drop an utterance without throwing or firing error.
    // Retry once, only if the queue is fully idle and this is still the newest
    // request. getVoices() refreshes Chrome's lazy voice registry without
    // overriding the user's configured default voice.
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      if (myGen !== generation || started || finished || retried) return;
      if (s.speaking || s.pending) return;
      retried = true;
      try {
        s.getVoices();
      } catch {}
      debugSpeech("retry", "utterance did not start");
      submit();
    }, 500);
  };

  try {
    if (s.paused) s.resume();
    if (s.speaking || s.pending) {
      s.cancel();
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null;
        if (myGen !== generation) return;
        submit();
      }, 40);
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
