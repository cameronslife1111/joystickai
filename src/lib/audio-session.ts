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

/** Restore normal speaker/media routing after iOS has owned the mic. */
export function requestIosPlaybackSession(): boolean {
  const session = iosAudioSession();
  if (!session) return false;
  try {
    session.type = "playback";
    return true;
  } catch {
    return false;
  }
}

export function iosAudioSessionState() {
  const session = iosAudioSession();
  return session ? { type: session.type, state: session.state ?? "unknown" } : null;
}