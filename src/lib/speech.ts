// Speech for the app.
//
// Two paths:
//   1. The browser's built-in speech engine (free, instant, local voice). Used
//      on desktop browsers, where it works.
//   2. Real audio playback of generated speech through one shared <audio>
//      element that is unlocked by the user's first tap. iPhone/iPad browsers
//      are allowed to silently refuse speechSynthesis, but they DO honor
//      programmatic play() on an element the user already started once — so
//      this is the primary path there, and the automatic fallback everywhere
//      else.

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

/** Anything a synthesizer can actually pronounce. */
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
 * WebKit and shares its restrictions.
 */
export function isWebKitMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1;
  return iOS || iPadOS;
}

/* ------------------------------ diagnostics ------------------------------ */

type Diag = { at: number; event: string; detail?: unknown };
const diagnostics: Diag[] = [];

function debugSpeech(event: string, detail?: unknown) {
  diagnostics.push({ at: Date.now(), event, detail });
  if (diagnostics.length > 40) diagnostics.splice(0, diagnostics.length - 40);
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    console.debug(`[speech] ${event}`, detail ?? "");
  }
}

/** Last few speech events, so a silent device can be diagnosed. */
export function speechDiagnostics(): Diag[] {
  return [...diagnostics];
}

if (typeof window !== "undefined") {
  (window as unknown as { orbySpeechLog?: () => Diag[] }).orbySpeechLog = speechDiagnostics;
}

/* -------------------------------- unlock --------------------------------- */

let unlocked = false;
let unlockArmed = false;

// 0.05s of silence, WAV. Playing this from a real tap blesses the element.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

let audioEl: HTMLAudioElement | null = null;
let audioUnlocked = false;

function getAudioEl(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (audioEl) return audioEl;
  try {
    const el = new Audio();
    el.preload = "auto";
    (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    el.setAttribute("playsinline", "");
    audioEl = el;
    return el;
  } catch {
    return null;
  }
}

/** True once at least one speech path has been blessed by a user gesture. */
export function speechUnlocked() {
  return unlocked || audioUnlocked;
}

export function audioPathReady() {
  return audioUnlocked;
}

/**
 * Bless both playback paths on the user's first interaction: submit a
 * near-silent utterance to the built-in engine, and start (then immediately
 * stop) the shared audio element. Both mechanisms require a real gesture, and
 * both stay blessed afterwards.
 */
export function installSpeechUnlock() {
  if (unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;

  const primeUtterances = new Set<SpeechSynthesisUtterance>();

  const primeAudio = () => {
    if (audioUnlocked) return;
    const el = getAudioEl();
    if (!el) return;
    try {
      el.muted = true;
      el.src = SILENCE;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          audioUnlocked = true;
          el.muted = false;
          debugSpeech("audio unlocked");
        }).catch((error) => {
          el.muted = false;
          debugSpeech("audio unlock blocked", String(error));
        });
      } else {
        audioUnlocked = true;
        el.muted = false;
      }
    } catch (error) {
      debugSpeech("audio unlock threw", String(error));
    }
  };

  const primeSynth = () => {
    const s = synth();
    if (!s || unlocked) return;
    try {
      s.getVoices();
    } catch {}
    try {
      if (s.paused) s.resume();
    } catch {}
    if (s.speaking || s.pending) {
      unlocked = true;
      return;
    }
    try {
      const prime = new SpeechSynthesisUtterance("\u00a0");
      prime.volume = 0.01;
      prime.rate = 2;
      const done = () => {
        primeUtterances.delete(prime);
        unlocked = true;
        debugSpeech("synth unlocked");
      };
      prime.onstart = done;
      prime.onend = done;
      prime.onerror = () => primeUtterances.delete(prime);
      primeUtterances.add(prime);
      s.speak(prime);
    } catch {}
  };

  const handler = () => {
    primeAudio();
    primeSynth();
    if (audioUnlocked && unlocked) removeListeners();
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") cancelSpeech();
  });
  window.addEventListener("pagehide", () => cancelSpeech());
}

/* --------------------------------- state --------------------------------- */

let generation = 0;
const liveUtterances = new Set<SpeechSynthesisUtterance>();
let pendingTimer: number | null = null;

/** Session cache: identical sentence -> base64 mp3. Re-reads are instant. */
const audioCache = new Map<string, string>();

function clearTimer() {
  if (pendingTimer != null && typeof window !== "undefined") {
    window.clearTimeout(pendingTimer);
  }
  pendingTimer = null;
}

export function cancelSpeech() {
  generation += 1;
  clearTimer();
  const el = audioEl;
  if (el) {
    try {
      el.pause();
    } catch {}
  }
  const s = synth();
  if (!s) return;
  try {
    if (s.paused) s.resume();
  } catch {}
  try {
    s.cancel();
  } catch {}
  const cancelled = [...liveUtterances];
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      for (const utterance of cancelled) liveUtterances.delete(utterance);
    }, 500);
  }
}

export function isSpeaking(): boolean {
  const el = audioEl;
  if (el && !el.paused && !el.ended) return true;
  const s = synth();
  if (!s) return false;
  try {
    return !!s.speaking;
  } catch {
    return false;
  }
}

/* ----------------------------- audio playback ---------------------------- */

async function fetchAudio(text: string): Promise<string> {
  const cached = audioCache.get(text);
  if (cached) return cached;
  const { synthesizeSpeech } = await import("./tts.functions");
  const { audio } = await synthesizeSpeech({ data: { text } });
  if (audioCache.size > 60) audioCache.clear();
  audioCache.set(text, audio);
  return audio;
}

function playAudio(text: string, myGen: number, opts: SpeakOpts) {
  debugSpeech("audio requested", { chars: text.length, cached: audioCache.has(text) });
  const el = getAudioEl();
  if (!el) {
    debugSpeech("audio element unavailable");
    opts.onError?.();
    return;
  }

  const start = (base64: string) => {
    if (myGen !== generation) return;
    try {
      el.pause();
      el.src = `data:audio/mpeg;base64,${base64}`;
      el.currentTime = 0;
      el.muted = false;
      el.volume = 1;
      el.onended = () => {
        if (myGen === generation) opts.onEnd?.();
      };
      el.playbackRate = opts.rate ?? 1;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => debugSpeech("audio playing")).catch((error) => {
          debugSpeech("audio blocked", String(error));
          if (myGen === generation) opts.onError?.();
        });
      }
    } catch (error) {
      debugSpeech("audio threw", String(error));
      if (myGen === generation) opts.onError?.();
    }
  };

  const cached = audioCache.get(text);
  if (cached) {
    start(cached);
    return;
  }
  fetchAudio(text)
    .then((base64) => {
      debugSpeech("audio fetched");
      start(base64);
    })
    .catch((error) => {
      debugSpeech("audio fetch failed", String(error));
      if (myGen === generation) opts.onError?.();
    });
}

/* ----------------------------- built-in engine --------------------------- */

function speakWithSynth(
  s: SpeechSynthesis,
  clean: string,
  myGen: number,
  opts: SpeakOpts,
  onSilentFailure: () => void,
) {
  let started = false;
  let finished = false;

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = opts.rate ?? 1;
  utterance.pitch = opts.pitch ?? 1;
  utterance.volume = 1;
  // Voice and lang are deliberately left unset: that is the only portable way
  // to honor the voice the browser or OS is configured to use.
  utterance.onstart = () => {
    started = true;
    unlocked = true;
    debugSpeech("synth start");
  };
  utterance.onend = () => {
    liveUtterances.delete(utterance);
    finished = true;
    unlocked = true;
    if (myGen === generation) opts.onEnd?.();
  };
  utterance.onerror = (event) => {
    liveUtterances.delete(utterance);
    debugSpeech("synth error", (event as SpeechSynthesisErrorEvent).error);
    if ((event as SpeechSynthesisErrorEvent).error === "canceled") return;
    if ((event as SpeechSynthesisErrorEvent).error === "interrupted") return;
    finished = true;
    if (myGen === generation && !started) onSilentFailure();
  };

  liveUtterances.add(utterance);
  try {
    if (s.paused) s.resume();
    s.speak(utterance);
    debugSpeech("synth queued", { pending: s.pending, speaking: s.speaking });
  } catch (error) {
    liveUtterances.delete(utterance);
    debugSpeech("synth threw", String(error));
    onSilentFailure();
    return;
  }

  // Silent-drop watchdog: no start event and an idle queue means the browser
  // discarded the utterance. Switch to audio playback instead of going quiet.
  clearTimer();
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    if (myGen !== generation || started || finished) return;
    if (s.speaking || s.pending) return;
    debugSpeech("synth silent drop");
    onSilentFailure();
  }, 900);
}

/* --------------------------------- speak --------------------------------- */

/** Speak the newest text. Newest request always wins. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  if (typeof window === "undefined") return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  const myGen = ++generation;
  clearTimer();

  // Always stop whatever is currently making sound.
  const el = audioEl;
  if (el) {
    try {
      el.pause();
    } catch {}
  }

  const s = synth();

  // iPhone/iPad: go straight to audio playback. The built-in engine there is
  // free to stay silent with no error, which is exactly what was happening.
  if (isWebKitMobile() || !s) {
    playAudio(clean, myGen, opts);
    return true;
  }

  try {
    if (s.speaking || s.pending) s.cancel();
  } catch {}

  const fallback = () => {
    if (myGen !== generation) return;
    playAudio(clean, myGen, opts);
  };

  try {
    speakWithSynth(s, clean, myGen, opts, fallback);
  } catch (error) {
    debugSpeech("synth path failed", String(error));
    fallback();
  }
  return true;
}
