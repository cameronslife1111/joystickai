type AudioSessionLike = {
  type: string;
  state?: string;
};

let mixableGeneration = 0;
let mixableTimers: ReturnType<typeof setTimeout>[] = [];
let recordingTokenSequence = 0;
const activeRecordingTokens = new Set<number>();

function iosAudioSession(): AudioSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const userAgent = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(userAgent)
    || (userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!isIos) return null;
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession ?? null;
}

function clearMixableTimers() {
  mixableGeneration += 1;
  for (const timer of mixableTimers) clearTimeout(timer);
  mixableTimers = [];
}

function scheduleMixableRetry(delay: number, generation: number) {
  const timer = setTimeout(() => {
    if (generation !== mixableGeneration || activeRecordingTokens.size > 0) return;
    requestIosMixableSession();
  }, delay);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  mixableTimers.push(timer);
}

function requestIosRecordingSession(): boolean {
  const session = iosAudioSession();
  if (!session) return false;
  for (const type of ["play-and-record", "auto"]) {
    try {
      session.type = type;
      if (session.type === type) return true;
    } catch {}
  }
  return false;
}

export function beginIosRecordingSession(): number | null {
  const session = iosAudioSession();
  if (!session) return null;
  clearMixableTimers();
  const token = ++recordingTokenSequence;
  activeRecordingTokens.add(token);
  requestIosRecordingSession();
  return token;
}

export function endIosRecordingSession(token: number | null): boolean {
  if (token !== null) activeRecordingTokens.delete(token);
  if (activeRecordingTokens.size > 0) return false;
  return assertMixableSessionWithRetries();
}

/**
 * Return to a MIXABLE audio category so speech synthesis layers on top of
 * whatever the user is already listening to. "playback" is exclusive on iOS and
 * pauses other apps' audio, so it must never be requested here.
 */
export function requestIosMixableSession(): boolean {
  if (activeRecordingTokens.size > 0) return false;
  const session = iosAudioSession();
  if (!session) return false;
  for (const type of ["ambient", "auto"]) {
    try {
      session.type = type;
      if (session.type === type) return true;
    } catch {}
  }
  return false;
}

/**
 * Re-assert the mixable category now and again over the next second. Right
 * after returning from an app that recorded audio (Voice Memos, a call), iOS
 * may still be handing the session back, so a single one-shot set can
 * silently lose the category. No-op on non-iOS platforms.
 */
export function assertMixableSessionWithRetries(): boolean {
  clearMixableTimers();
  if (activeRecordingTokens.size > 0) return false;
  if (!requestIosMixableSession()) return false;
  const generation = mixableGeneration;
  for (const delay of [300, 1_000]) {
    scheduleMixableRetry(delay, generation);
  }
  return true;
}

export function iosAudioSessionState() {
  const session = iosAudioSession();
  return session ? { type: session.type, state: session.state ?? "unknown" } : null;
}
