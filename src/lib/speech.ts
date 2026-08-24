// Shared native browser speech wrapper.

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

let audibleSpeaking = false;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let speechGeneration = 0;

function detach(utterance: SpeechSynthesisUtterance) {
  utterance.onstart = null;
  utterance.onboundary = null;
  utterance.onend = null;
  utterance.onerror = null;
}

export function cancelSpeech() {
  speechGeneration += 1;
  const s = synth();
  audibleSpeaking = false;
  if (activeUtterance) {
    detach(activeUtterance);
    activeUtterance = null;
  }
  if (!s) return;
  try {
    s.cancel();
  } catch {}
}


export function isSpeaking(): boolean {
  return audibleSpeaking;
}

/** Speak one sentence with the browser's normal native speech engine. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const s = synth();
  if (!s) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  const generation = ++speechGeneration;
  const replacing = activeUtterance !== null;
  if (activeUtterance) {
    detach(activeUtterance);
    activeUtterance = null;
  }
  audibleSpeaking = false;
  if (replacing) {
    try {
      s.cancel();
    } catch {}
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = opts.rate ?? 1;
  utterance.pitch = opts.pitch ?? 1;
  utterance.onstart = () => {
    if (generation === speechGeneration && activeUtterance === utterance) audibleSpeaking = true;
  };
  utterance.onboundary = () => {
    if (generation === speechGeneration && activeUtterance === utterance) audibleSpeaking = true;
  };
  utterance.onend = () => {
    if (generation !== speechGeneration || activeUtterance !== utterance) return;
    activeUtterance = null;
    audibleSpeaking = false;
    opts.onEnd?.();
  };
  utterance.onerror = () => {
    if (generation !== speechGeneration || activeUtterance !== utterance) return;
    activeUtterance = null;
    audibleSpeaking = false;
    opts.onError?.();
  };
  activeUtterance = utterance;

  // Keep the native call in the same user-activation turn as the button press.
  // Current WebKit protects a newly queued utterance from a preceding cancel.
  try {
    s.speak(utterance);
  } catch {
    if (generation === speechGeneration && activeUtterance === utterance) {
      activeUtterance = null;
    }
    audibleSpeaking = false;
    opts.onError?.();
  }
  return true;
}
