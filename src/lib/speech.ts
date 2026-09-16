import { onIosAudioSessionInterrupted } from "@/lib/audio-session";
import { stopMicForPlayback } from "@/lib/audio-recorder";

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu;

/** Anything that a synthesizer can actually pronounce. */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

/**
 * Slightly-brisker-than-normal pace applied to the device voice. 1.0 is the
 * system default; this stops sentences dragging without sounding rushed.
 */
export const SPEECH_RATE = 1;

export function cleanForSpeech(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Device speech. Sentences are read by the browser's built-in speech engine
// (SpeechSynthesis) using whatever voice the user has selected on their
// device. No network, no cost, no loading — the sentence starts on the press.
// ---------------------------------------------------------------------------

let audibleSpeaking = false;
let requestSequence = 0;
/** Strong reference to the live utterance: WebKit garbage-collects otherwise. */
let activeUtterance: SpeechSynthesisUtterance | null = null;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;
let noSupportReported = false;

// Master switch synced from the user's Sound preference. Default OFF until
// preferences load, so nothing is ever spoken before we know the setting.
let speechEnabled = false;

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  if (!on) cancelSpeech();
}

export function isSpeechEnabled(): boolean {
  return speechEnabled;
}

// Temporary override held while a hands-free voice call is live: the call has
// its own voice, so no other speech path in the app may play.
let speechSuppressed = false;

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
  if (!engine || typeof engine.speak !== "function") return null;
  return engine;
}

function emitSpeechError(message: string) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("orby-speech-error", { detail: message }));
    } catch {}
  }
}

/**
 * Resolve a concrete on-device voice for the retry path. The first attempt
 * deliberately leaves `voice` unset so the engine uses the user's own default;
 * only when that never starts do we pin an explicit local voice.
 */
function fallbackVoice(engine: SpeechSynthesis): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = engine.getVoices?.() ?? [];
  } catch {
    return null;
  }
  if (voices.length === 0) return null;
  const language = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  const base = language.split("-")[0];
  return (
    voices.find((v) => v.default && v.localService) ??
    voices.find((v) => v.default) ??
    voices.find((v) => v.localService && v.lang?.startsWith(base)) ??
    voices.find((v) => v.lang?.startsWith(base)) ??
    voices.find((v) => v.localService) ??
    voices[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Gesture primer. iOS/Safari only lets speech start once the page has had a
// real user interaction, and getVoices() is often empty until then. Warm both
// on the first tap/keypress — never by queueing a silent utterance, which can
// wedge WebKit's queue.
// ---------------------------------------------------------------------------

let primerAttached = false;
let primed = false;

function primeSpeech() {
  const engine = synth();
  if (!engine) return;
  primed = true;
  try {
    engine.getVoices?.();
  } catch {}
  try {
    if (engine.paused) engine.resume();
  } catch {}
}

function attachPrimer() {
  if (primerAttached) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  primerAttached = true;
  const onGesture = () => primeSpeech();
  for (const event of ["pointerdown", "touchend", "keydown"] as const) {
    window.addEventListener(event, onGesture, { passive: true });
  }
  const engine = synth();
  if (engine && typeof engine.addEventListener === "function") {
    // Voices arrive asynchronously on some engines.
    engine.addEventListener("voiceschanged", () => {
      try {
        engine.getVoices?.();
      } catch {}
    });
  }
  attachForegroundRecovery();
}

// ---------------------------------------------------------------------------
// Lifecycle recovery: app switches, screen locks and calls can leave WebKit's
// speech queue reporting activity while nothing plays. Clearing state on
// return guarantees the next press starts cleanly.
// ---------------------------------------------------------------------------

let recoveryListenersAttached = false;
let wasHidden = false;
/** Set whenever the app was backgrounded: the engine may be wedged. */
let engineStale = false;
let resetTimers: ReturnType<typeof setTimeout>[] = [];
let removeAudioSessionListener: (() => void) | null = null;

function clearResetTimers() {
  for (const timer of resetTimers) clearTimeout(timer);
  resetTimers = [];
}

/**
 * Force WebKit's queue back to idle. After an app switch, a phone call or a
 * screen lock, `speechSynthesis` can keep reporting `speaking` forever while
 * producing no sound, and a single cancel() often isn't enough — resume first
 * (a suspended queue ignores cancel), then cancel, repeatedly over ~1s.
 */
function hardResetEngine() {
  const engine = synth();
  if (!engine) return;
  const kick = () => {
    try {
      if (engine.paused) engine.resume();
    } catch {}
    try {
      engine.cancel();
    } catch {}
  };
  kick();
  clearResetTimers();
  for (const delay of [50, 200, 600]) {
    const timer = setTimeout(() => {
      if (audibleSpeaking) return; // real speech started meanwhile
      kick();
    }, delay);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    resetTimers.push(timer);
  }
}

export function handleAppForeground() {
  cancelSpeech();
  engineStale = true;
  primed = false;
  hardResetEngine();
  primeSpeech();
}

function pageIsVisible(): boolean {
  if (typeof document === "undefined" || !document.visibilityState) return true;
  return document.visibilityState === "visible";
}

function attachForegroundRecovery() {
  if (recoveryListenersAttached) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  recoveryListenersAttached = true;
  const onMaybeForeground = () => {
    if (!pageIsVisible()) {
      wasHidden = true;
      cancelSpeech();
      engineStale = true;
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
    wasHidden = true;
    engineStale = true;
    cancelSpeech();
  });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onMaybeForeground);
  }
  removeAudioSessionListener?.();
  removeAudioSessionListener = onIosAudioSessionInterrupted(() => {
    engineStale = true;
    wasHidden = true;
    cancelSpeech();
  });
}

// Attach lifecycle recovery as soon as the module loads in a browser, so a
// background/foreground round-trip is caught even before the first sentence.
if (typeof window !== "undefined") {
  try {
    attachForegroundRecovery();
  } catch {}
}

export function cancelSpeech() {
  requestSequence += 1;
  audibleSpeaking = false;
  activeUtterance = null;
  if (startWatchdog) clearTimeout(startWatchdog);
  startWatchdog = null;
  clearResetTimers();
  const engine = synth();
  if (!engine) return;
  try {
    engine.cancel();
  } catch {}
}

export function isSpeaking(): boolean {
  return audibleSpeaking;
}

/** Test hook / no-op holdover: device speech keeps no caches. */
export function resetSpeechCaches() {
  cancelSpeech();
  primed = false;
}

/**
 * Speak one sentence with the device's own voice. Returns false when speech is
 * off, suppressed, unavailable, or the text has nothing pronounceable.
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
  // Take the audio route back from any held microphone and keep the iOS
  // category mixable so speech layers over the user's music.
  stopMicForPlayback();

  // Replace whatever is being read: single cancel, then speak, in the same
  // user-gesture turn so WebKit allows the new utterance to start.
  cancelSpeech();
  if (engineStale) {
    // First press after coming back from another app: the queue can still be
    // suspended or holding a phantom utterance. Resume + cancel before speaking.
    engineStale = false;
    try {
      if (engine.paused) engine.resume();
    } catch {}
    try {
      engine.cancel();
    } catch {}
  }
  const sequence = requestSequence;
  let recoveryAttempts = 0;

  const speak = (voice: SpeechSynthesisVoice | null, isRetry: boolean) => {
    // Reassert for every submission: a watchdog retry can happen after iOS has
    // changed the category during an interruption or microphone hand-back.
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = opts.rate ?? SPEECH_RATE;
    if (opts.pitch !== undefined) utterance.pitch = opts.pitch;
    if (voice) {
      utterance.voice = voice;
      if (voice.lang) utterance.lang = voice.lang;
    }

    const settle = () => {
      if (sequence !== requestSequence) return false;
      if (startWatchdog) clearTimeout(startWatchdog);
      startWatchdog = null;
      audibleSpeaking = false;
      activeUtterance = null;
      return true;
    };

    utterance.onstart = () => {
      if (sequence !== requestSequence) return;
      if (startWatchdog) clearTimeout(startWatchdog);
      startWatchdog = null;
      audibleSpeaking = true;
    };
    utterance.onend = () => {
      if (!settle()) return;
      opts.onEnd?.();
    };
    utterance.onerror = () => {
      if (sequence !== requestSequence) return;
      if (!isRetry) {
        // A rejected utterance on iOS usually means the implicit default voice
        // could not be resolved — try once with an explicit local voice.
        const retryVoice = fallbackVoice(engine);
        if (retryVoice) {
          speak(retryVoice, true);
          return;
        }
      }
      if (!settle()) return;
      emitSpeechError("Speech couldn't start — please try again");
      opts.onError?.();
    };

    activeUtterance = utterance;
    // Watchdog: nothing started, and no error either (a silently swallowed or
    // phantom WebKit utterance). Recover by forcing the queue idle and
    // resubmitting, then by pinning an explicit voice, then give up.
    if (startWatchdog) clearTimeout(startWatchdog);
    startWatchdog = setTimeout(() => {
      if (sequence !== requestSequence || audibleSpeaking) return;
      startWatchdog = null;
      if (recoveryAttempts < 2) {
        // Never trust engine.speaking here: after an app switch iOS reports an
        // active queue while playing nothing. Force it idle and try again.
        recoveryAttempts += 1;
        const voice = isRetry ? null : fallbackVoice(engine);
        try {
          if (engine.paused) engine.resume();
        } catch {}
        try {
          engine.cancel();
        } catch {}
        speak(voice, isRetry || voice !== null);
        return;
      }
      audibleSpeaking = false;
      activeUtterance = null;
      emitSpeechError("Speech couldn't start — please try again");
      opts.onError?.();
    }, 900);

    try {
      if (engine.paused) engine.resume();
    } catch {}
    try {
      engine.speak(utterance);
    } catch {
      if (!settle()) return;
      emitSpeechError("Speech couldn't start — please try again");
      opts.onError?.();
    }
  };

  speak(null, false);
  return true;
}

/** Kept for callers that still reference it — device speech needs no warming. */
export function cancelPrewarm() {}
