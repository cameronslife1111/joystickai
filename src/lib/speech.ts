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
    try {
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
const liveUtterances = new Set<SpeechSynthesisUtterance>();

function debugSpeech(event: string, detail?: unknown) {
  if (import.meta.env.DEV) console.debug(`[speech] ${event}`, detail ?? "");
}

export function cancelSpeech() {
  const s = synth();
  if (!s) return;
  generation += 1;
  try {
    if (s.paused) s.resume();
  } catch {}
  try {
    s.cancel();
  } catch {}
  liveUtterances.clear();
}

/**
 * Clear the previous sentence at pointer-down. The matching pointer-up can then
 * submit the new utterance directly, without cancel-and-speak in one event.
 */
export function prepareSpeech() {
  cancelSpeech();
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
 * Speak one utterance immediately. Voice and language intentionally remain
 * unset: this is the standards-defined path for using the browser/device
 * default voice, including the current default available to Safari on iPhone.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const s = synth();
  if (!s) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  const myGen = ++generation;
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = opts.rate ?? 1;
  utterance.pitch = opts.pitch ?? 1;
  utterance.volume = 1;
  utterance.onstart = () => {
    unlocked = true;
    debugSpeech("start", "browser default voice");
  };
  utterance.onend = () => {
    liveUtterances.delete(utterance);
    unlocked = true;
    if (myGen === generation) opts.onEnd?.();
  };
  utterance.onerror = (event) => {
    liveUtterances.delete(utterance);
    debugSpeech("error", event.error);
    if (myGen === generation) opts.onError?.();
  };

  liveUtterances.add(utterance);
  try {
    if (s.paused) s.resume();
    s.speak(utterance);
    debugSpeech("queued", { pending: s.pending, speaking: s.speaking });
  } catch (error) {
    liveUtterances.delete(utterance);
    debugSpeech("throw", error);
    opts.onError?.();
    return false;
  }
  return true;
}
