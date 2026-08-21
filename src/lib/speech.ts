// Single speech engine for the whole app.
//
// Hard-won rules for newer WebKit (iOS 26/27, macOS 26+):
//  - Do NOT assign utterance.voice. An explicitly assigned voice object is
//    frequently rejected and the utterance is dropped with no error — and it
//    also overrides the voice the user picked in
//    Settings > Accessibility > Spoken Content > Voices. Leaving it unset makes
//    WebKit use the system default voice, which is what the user expects.
//  - Do NOT prime with a fake/near-silent utterance. The primer consumes the
//    gesture blessing and the real sentence right after it gets dropped.
//  - Do NOT cancel() an idle engine. A no-op cancel can leave the queue in a
//    paused state where speak() silently does nothing.
//  - Queue the real utterance synchronously, in the same tick as the gesture.
//  - Long strings stop mid-way, so chunk them into sentence-sized pieces.

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

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

/* ------------------------------- voices -------------------------------- */
// We never force a voice by default. getVoices() is only warmed so the engine
// has its voice list ready (an empty list at first speak is another silent-drop
// trigger) and so the diagnostic can report what the device sees.

let voicesBound = false;
let lastVoices: SpeechSynthesisVoice[] = [];

function warmVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  try {
    lastVoices = s.getVoices() ?? [];
  } catch {
    lastVoices = [];
  }
  if (!voicesBound) {
    voicesBound = true;
    try {
      s.addEventListener?.("voiceschanged", () => {
        try {
          lastVoices = s.getVoices() ?? [];
        } catch {}
      });
    } catch {}
  }
  return lastVoices;
}

/** The device's own default voice, as reported by the platform (may be null). */
export function defaultVoiceName(): string | null {
  const voices = lastVoices.length ? lastVoices : warmVoices();
  const def = voices.find((v) => v.default);
  return def?.name ?? voices[0]?.name ?? null;
}

/* ------------------------------- unlock -------------------------------- */

let unlocked = false;
let unlockArmed = false;

/** True once the engine has confirmed at least one utterance actually ran. */
export function speechUnlocked() {
  return unlocked;
}

/**
 * Arm the gesture warm-up. This does NOT speak anything: it only resumes the
 * queue and warms the voice list on the first interactions. The user's first
 * real sentence becomes the gesture-blessed utterance.
 */
export function installSpeechUnlock() {
  if (unlockArmed) return;
  const s = synth();
  if (!s) return;
  unlockArmed = true;
  const handler = () => {
    warmVoices();
    try {
      s.resume();
    } catch {}
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("touchstart", handler, true);
  window.addEventListener("mousedown", handler, true);
  window.addEventListener("click", handler, true);
  window.addEventListener("keydown", handler, true);
}

/* -------------------------------- speak -------------------------------- */

let generation = 0;

export function cancelSpeech() {
  const s = synth();
  if (!s) return;
  generation += 1;
  try {
    // Only touch the queue when there is actually something in it.
    if (s.speaking || s.pending) {
      s.resume();
      s.cancel();
    }
  } catch {}
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

const MAX_CHUNK = 200;

/** Split long text into sentence-sized chunks WebKit won't choke on. */
function chunkText(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const parts = text.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = "";
  };
  for (const part of parts) {
    if (part.length > MAX_CHUNK) {
      push();
      // Hard-split an over-long run on word boundaries.
      let rest = part.trim();
      while (rest.length > MAX_CHUNK) {
        let cut = rest.lastIndexOf(" ", MAX_CHUNK);
        if (cut < MAX_CHUNK * 0.5) cut = MAX_CHUNK;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
      continue;
    }
    if (buf.length + part.length > MAX_CHUNK) push();
    buf += part;
  }
  push();
  return out.length ? out : [text];
}

function makeUtterance(text: string, opts: SpeakOpts): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;
  u.volume = 1;
  // Deliberately no u.voice and no u.lang: the platform default voice (the one
  // chosen in the device's own settings) is used.
  return u;
}

/**
 * Speak `text`, cancelling anything already in flight. Returns false when the
 * platform has no speech support or the text is empty after cleaning.
 *
 * Must be called synchronously from the user gesture that requested it.
 */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const s = synth();
  if (!s) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean) return false;

  const myGen = ++generation;
  const chunks = chunkText(clean);
  let started = false;
  let finished = false;

  const queue = () => {
    chunks.forEach((chunk, i) => {
      const u = makeUtterance(chunk, opts);
      if (i === 0) {
        u.onstart = () => {
          started = true;
          unlocked = true;
        };
      }
      if (i === chunks.length - 1) {
        u.onend = () => {
          finished = true;
          unlocked = true;
          if (myGen === generation) opts.onEnd?.();
        };
      }
      u.onerror = () => {
        if (i === chunks.length - 1) finished = true;
        if (myGen === generation) opts.onError?.();
      };
      s.speak(u);
    });
  };

  try {
    // Clear only a live queue, then queue immediately — still inside the
    // gesture's task, which is what WebKit requires.
    if (s.speaking || s.pending) {
      s.cancel();
    }
    s.resume();
    queue();
  } catch {
    return false;
  }

  // One verification pass: if the engine reports nothing queued and nothing
  // speaking, the utterances were swallowed — resume and queue once more.
  window.setTimeout(() => {
    if (myGen !== generation || finished || started) return;
    try {
      if (s.speaking || s.pending) {
        s.resume();
        return;
      }
      s.resume();
      queue();
    } catch {}
  }, 250);

  return true;
}

/* ----------------------------- diagnostics ----------------------------- */

export type SpeechDiagnostic = {
  supported: boolean;
  voiceCount: number;
  defaultVoice: string | null;
  speaking: boolean;
  pending: boolean;
  paused: boolean;
  started: boolean;
};

/**
 * Speak a short test phrase and report what the engine did. Call this
 * synchronously from a tap so the gesture context is intact.
 */
export function runSpeechDiagnostic(
  onResult: (d: SpeechDiagnostic) => void,
  phrase = "Speech is working.",
) {
  const s = synth();
  if (!s) {
    onResult({
      supported: false,
      voiceCount: 0,
      defaultVoice: null,
      speaking: false,
      pending: false,
      paused: false,
      started: false,
    });
    return;
  }
  const voices = warmVoices();
  let started = false;
  const myGen = ++generation;
  try {
    if (s.speaking || s.pending) s.cancel();
    s.resume();
    const u = makeUtterance(phrase, {});
    u.onstart = () => {
      started = true;
      unlocked = true;
    };
    s.speak(u);
  } catch {}
  window.setTimeout(() => {
    void myGen;
    onResult({
      supported: true,
      voiceCount: voices.length || warmVoices().length,
      defaultVoice: defaultVoiceName(),
      speaking: (() => {
        try {
          return !!s.speaking;
        } catch {
          return false;
        }
      })(),
      pending: (() => {
        try {
          return !!s.pending;
        } catch {
          return false;
        }
      })(),
      paused: (() => {
        try {
          return !!s.paused;
        } catch {
          return false;
        }
      })(),
      started,
    });
  }, 900);
}
