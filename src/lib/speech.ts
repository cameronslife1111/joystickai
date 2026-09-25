import {
  beginIosSpeechSession,
  endIosSpeechSession,
  onIosAudioSessionInterrupted,
  reclaimIosSpeechSession,
} from "@/lib/audio-session";

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu;
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;
const START_WATCHDOG_MS = 1_200;
const CANCEL_SETTLE_MS = 40;

export const SPEECH_RATE = 1;

export function cleanForSpeech(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

let audibleSpeaking = false;
let requestSequence = 0;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;
let replacementTimer: ReturnType<typeof setTimeout> | null = null;
let speechEnabled = false;
let speechSuppressed = false;
let noSupportReported = false;
let needsGestureRecovery = false;

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  if (!on) cancelSpeech();
}

export function isSpeechEnabled(): boolean {
  return speechEnabled;
}

export function setSpeechSuppressed(on: boolean) {
  speechSuppressed = on;
  if (on) cancelSpeech();
}

export function isSpeechSuppressed(): boolean {
  return speechSuppressed;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const engine = window.speechSynthesis;
  return engine && typeof engine.speak === "function" ? engine : null;
}

function emitSpeechError(message: string) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent("orby-speech-error", { detail: message }));
  } catch {}
}

function fallbackVoice(engine: SpeechSynthesis): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = engine.getVoices?.() ?? [];
  } catch {
    return null;
  }
  const language = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  const base = language.split("-")[0];
  return (
    voices.find((voice) => voice.default && voice.localService) ??
    voices.find((voice) => voice.default) ??
    voices.find((voice) => voice.localService && voice.lang?.startsWith(base)) ??
    voices.find((voice) => voice.lang?.startsWith(base)) ??
    voices.find((voice) => voice.localService) ??
    voices[0] ??
    null
  );
}

let primerAttached = false;
let primed = false;

function primeSpeech() {
  const engine = synth();
  if (!engine) return;
  primed = true;
  try {
    engine.getVoices?.();
  } catch {}
}

function clearTimers() {
  if (startWatchdog) clearTimeout(startWatchdog);
  if (replacementTimer) clearTimeout(replacementTimer);
  startWatchdog = null;
  replacementTimer = null;
}

function detachActive() {
  if (!activeUtterance) return;
  activeUtterance.onstart = null;
  activeUtterance.onend = null;
  activeUtterance.onerror = null;
}

function stopActive(engine: SpeechSynthesis | null, restoreIdleSession: boolean) {
  requestSequence += 1;
  clearTimers();
  detachActive();
  activeUtterance = null;
  audibleSpeaking = false;
  if (engine) {
    try {
      engine.cancel();
    } catch {}
  }
  if (restoreIdleSession) endIosSpeechSession();
}

function markSpeechStale(stopCurrent: boolean) {
  needsGestureRecovery = true;
  primed = false;
  if (stopCurrent) stopActive(synth(), true);
}

/** Foreground events only mark speech stale. Recovery waits for a real press. */
export function handleAppForeground() {
  markSpeechStale(false);
}

function pageIsVisible(): boolean {
  if (typeof document === "undefined" || !document.visibilityState) return true;
  return document.visibilityState === "visible";
}

let recoveryListenersAttached = false;
let wasHidden = false;
let removeAudioSessionListener: (() => void) | null = null;

function attachForegroundRecovery() {
  if (recoveryListenersAttached || typeof window === "undefined") return;
  if (typeof window.addEventListener !== "function") return;
  recoveryListenersAttached = true;

  const onMaybeForeground = () => {
    if (!pageIsVisible()) {
      if (!wasHidden) markSpeechStale(true);
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    handleAppForeground();
  };

  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) wasHidden = true;
    onMaybeForeground();
  });
  window.addEventListener("focus", onMaybeForeground);
  window.addEventListener("pagehide", () => {
    if (!wasHidden) markSpeechStale(true);
    wasHidden = true;
  });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onMaybeForeground);
  }
  removeAudioSessionListener?.();
  removeAudioSessionListener = onIosAudioSessionInterrupted(() => {
    markSpeechStale(true);
  });
}

function attachPrimer() {
  if (primerAttached || typeof window === "undefined") return;
  if (typeof window.addEventListener !== "function") return;
  primerAttached = true;
  const onGesture = () => primeSpeech();
  for (const event of ["pointerdown", "touchend", "keydown"] as const) {
    window.addEventListener(event, onGesture, { passive: true });
  }
  const engine = synth();
  engine?.addEventListener?.("voiceschanged", primeSpeech);
  attachForegroundRecovery();
}

if (typeof window !== "undefined") {
  try {
    attachForegroundRecovery();
  } catch {}
}

export function cancelSpeech() {
  stopActive(synth(), true);
}

export function isSpeaking(): boolean {
  return audibleSpeaking;
}

export function resetSpeechCaches() {
  cancelSpeech();
  primed = false;
  needsGestureRecovery = false;
}

/**
 * Speak one sentence with the device voice. Foreground recovery happens here,
 * inside the navigation press that requested speech, rather than in a passive
 * visibility callback that iPhone is free to ignore.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  if (!speechEnabled || speechSuppressed) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  const engine = synth();
  if (!engine) {
    if (!noSupportReported) {
      noSupportReported = true;
      emitSpeechError("This device doesn't support reading aloud.");
    }
    opts.onError?.();
    return false;
  }

  attachPrimer();
  if (!primed) primeSpeech();

  const recovering = needsGestureRecovery;
  needsGestureRecovery = false;
  if (recovering) {
    reclaimIosSpeechSession();
    try {
      if (engine.paused) engine.resume();
    } catch {}
  }

  const replacing = activeUtterance !== null;
  requestSequence += 1;
  const sequence = requestSequence;
  clearTimers();
  detachActive();
  activeUtterance = null;
  audibleSpeaking = false;

  if (replacing) {
    try {
      engine.cancel();
    } catch {}
  }

  let retriedWithVoice = false;

  const finish = () => {
    if (sequence !== requestSequence) return false;
    clearTimers();
    detachActive();
    activeUtterance = null;
    audibleSpeaking = false;
    endIosSpeechSession();
    return true;
  };

  const fail = () => {
    if (!finish()) return;
    needsGestureRecovery = true;
    emitSpeechError("Speech couldn't start — please try again");
    opts.onError?.();
  };

  const launch = (voice: SpeechSynthesisVoice | null) => {
    if (sequence !== requestSequence) return;
    beginIosSpeechSession();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = opts.rate ?? SPEECH_RATE;
    if (opts.pitch !== undefined) utterance.pitch = opts.pitch;
    if (voice) {
      utterance.voice = voice;
      if (voice.lang) utterance.lang = voice.lang;
    }

    const retryOrFail = () => {
      if (sequence !== requestSequence) return;
      if (!retriedWithVoice) {
        const retryVoice = fallbackVoice(engine);
        if (retryVoice) {
          retriedWithVoice = true;
          clearTimers();
          detachActive();
          activeUtterance = null;
          try {
            engine.cancel();
          } catch {}
          replacementTimer = setTimeout(() => {
            replacementTimer = null;
            launch(retryVoice);
          }, CANCEL_SETTLE_MS);
          return;
        }
      }
      fail();
    };

    utterance.onstart = () => {
      if (sequence !== requestSequence || activeUtterance !== utterance) return;
      if (startWatchdog) clearTimeout(startWatchdog);
      startWatchdog = null;
      audibleSpeaking = true;
    };
    utterance.onend = () => {
      if (!finish()) return;
      opts.onEnd?.();
    };
    utterance.onerror = retryOrFail;
    activeUtterance = utterance;
    startWatchdog = setTimeout(() => {
      startWatchdog = null;
      if (sequence !== requestSequence || audibleSpeaking) return;
      retryOrFail();
    }, START_WATCHDOG_MS);

    try {
      engine.speak(utterance);
    } catch {
      retryOrFail();
    }
  };

  // WebKit clears cancellation asynchronously. Let that operation settle before
  // submitting the newest sentence, while keeping only the latest request alive.
  if (replacing) {
    replacementTimer = setTimeout(() => {
      replacementTimer = null;
      launch(null);
    }, CANCEL_SETTLE_MS);
  } else {
    launch(null);
  }
  return true;
}

export function cancelPrewarm() {}