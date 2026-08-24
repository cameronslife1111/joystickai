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
 * Return the page to the default ("auto") audio category after microphone
 * capture or a WebRTC call ends. "auto" is the untouched state where iOS
 * speechSynthesis ducks background music (Music/YouTube) and still plays
 * while the Ring/Silent switch is on.
 *
 * Never request "ambient" here — it respects the silent switch, muting
 * speech. Never request "playback" — it is exclusive and pauses other apps'
 * audio. Only ever restore the default.
 */
export function restoreDefaultAudioSession(): boolean {
  const session = iosAudioSession();
  if (!session) return false;
  try {
    session.type = "auto";
    return session.type === "auto";
  } catch {
    return false;
  }
}
