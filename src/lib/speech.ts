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
let pendingSpeak: ReturnType<typeof setTimeout> | null = null;

function detach(utterance: SpeechSynthesisUtterance) {
  utterance.onstart = null;
  utterance.onboundary = null;
  utterance.onend = null;
  utterance.onerror = null;
}

export function cancelSpeech() {
  speechGeneration += 1;
  if (pendingSpeak !== null) {
    clearTimeout(pendingSpeak);
    pendingSpeak = null;
  }
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
  const replacing = activeUtterance !== null || pendingSpeak !== null;
  if (pendingSpeak !== null) {
    clearTimeout(pendingSpeak);
    pendingSpeak = null;
  }
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
    if (activeUtterance === utterance) audibleSpeaking = true;
  };
  utterance.onboundary = () => {
    if (activeUtterance === utterance) audibleSpeaking = true;
  };
  utterance.onend = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    audibleSpeaking = false;
    opts.onEnd?.();
  };
  utterance.onerror = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    audibleSpeaking = false;
    opts.onError?.();
  };
  activeUtterance = utterance;

  const submit = () => {
    pendingSpeak = null;
    if (generation !== speechGeneration || activeUtterance !== utterance) return;
    try {
      s.speak(utterance);
    } catch {
      if (activeUtterance === utterance) activeUtterance = null;
      audibleSpeaking = false;
      opts.onError?.();
    }
  };

  // Current WebKit can let cancel() clear a speak() submitted in the same
  // task. Idle speech stays synchronous; replacements cross one task boundary.
  if (replacing) pendingSpeak = setTimeout(submit, 0);
  else submit();
  return true;
}
