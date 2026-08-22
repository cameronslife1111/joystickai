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

/**
 * iPhone/iPad — every browser there (Chrome, Edge, Firefox included) runs on
 * WebKit and shares its user-activation rules for speech.
 */
function isWebKitMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1;
  return iOS || iPadOS;
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

  const primeUtterances = new Set<SpeechSynthesisUtterance>();

  const handler = () => {
    // Chrome can populate its voices asynchronously. Warming the list here is
    // harmless when it is already ready and avoids a cold first utterance.
    try {
      s.getVoices();
    } catch {}
    try {
      if (s.paused) s.resume();
    } catch {}
    if (unlocked) {
      removeListeners();
      return;
    }
    // Don't disturb real speech that is already in flight.
    if (s.speaking || s.pending) {
      unlocked = true;
      removeListeners();
      return;
    }
    try {
      const prime = new SpeechSynthesisUtterance("\u00a0");
      prime.volume = 0.01;
      prime.rate = 2;
      const done = () => {
        primeUtterances.delete(prime);
        unlocked = true;
        removeListeners();
        debugSpeech("unlocked");
      };
      prime.onstart = done;
      prime.onend = done;
      prime.onerror = () => {
        primeUtterances.delete(prime);
      };
      primeUtterances.add(prime);
      s.speak(prime);
    } catch {}
  };

  const resetWhenHidden = () => {
    if (document.visibilityState !== "hidden") return;
    cancelSpeech();
  };

  const removeListeners = () => {
    window.removeEventListener("pointerdown", handler, true);
    window.removeEventListener("touchstart", handler, true);
    window.removeEventListener("mousedown", handler, true);
    window.removeEventListener("keydown", handler, true);
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
  const cancelled = [...liveUtterances];
  window.setTimeout(() => {
    for (const utterance of cancelled) liveUtterances.delete(utterance);
  }, 500);
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
      if (isWebKitMobile()) {
        // iOS (all browsers) only honors speak() while the user gesture is
        // still live, so we must not defer submission to a timer.
        submit();
      } else {
        let checks = 0;
        const submitWhenIdle = () => {
          pendingTimer = null;
          if (myGen !== generation) return;
          if ((s.speaking || s.pending) && checks < 12) {
            checks += 1;
            pendingTimer = window.setTimeout(submitWhenIdle, 25);
            return;
          }
          submit();
        };
        pendingTimer = window.setTimeout(submitWhenIdle, 25);
      }
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
