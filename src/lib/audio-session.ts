type AudioSessionLike = {
  type: string;
  state?: string;
};

function iosAudioSession(): AudioSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const userAgent = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(userAgent)
    || (userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!isIos) return null;
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession ?? null;
}

/**
 * Return to a MIXABLE audio category so speech synthesis layers on top of
 * whatever the user is already listening to. "playback" is exclusive on iOS and
 * pauses other apps' audio, so it must never be requested here.
 */
export function requestIosMixableSession(): boolean {
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
export function assertMixableSessionWithRetries() {
  if (!requestIosMixableSession()) return;
  for (const delay of [300, 1_000]) {
    setTimeout(() => {
      requestIosMixableSession();
    }, delay);
  }
}

export function iosAudioSessionState() {
  const session = iosAudioSession();
  return session ? { type: session.type, state: session.state ?? "unknown" } : null;
}
