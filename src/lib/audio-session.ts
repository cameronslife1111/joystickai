type AudioSessionLike = {
  type: string;
  state?: string;
  addEventListener?: (type: "statechange", listener: () => void) => void;
  removeEventListener?: (type: "statechange", listener: () => void) => void;
};

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

/**
 * Recording is the ONLY thing in the app that claims an audio category. Sentence
 * speech deliberately requests nothing: the device's own speech engine keeps its
 * native session, which is what lets it mix with other audio and stay audible
 * with the ring/silent switch on. Any category we set here would move page audio
 * onto the ring-switch channel.
 */
export function beginIosRecordingSession(): number | null {
  const session = iosAudioSession();
  if (!session) return null;
  const token = ++recordingTokenSequence;
  activeRecordingTokens.add(token);
  requestIosRecordingSession();
  return token;
}

/**
 * Release the recording category once every recording has ended, handing the
 * page back to its untouched default. No retries, no exclusive category: we drop
 * the recording route and then stay out of the way.
 */
export function endIosRecordingSession(token: number | null): boolean {
  if (token !== null) activeRecordingTokens.delete(token);
  if (activeRecordingTokens.size > 0) return false;
  const session = iosAudioSession();
  if (!session) return false;
  try {
    session.type = "ambient";
    return session.type === "ambient";
  } catch {
    return false;
  }
}

/**
 * Ask for the shared ("ambient") category before the device speech engine
 * speaks. Ambient is the one category iOS treats as mixable, so music and
 * another app's recording keep running underneath. We never set it while a
 * recording of our own is live, which owns `play-and-record`.
 */
export function requestIosMixableSession(): boolean {
  if (activeRecordingTokens.size > 0) return false;
  const session = iosAudioSession();
  if (!session) return false;
  try {
    if (session.type === "ambient") return true;
    session.type = "ambient";
    return session.type === "ambient";
  } catch {
    return false;
  }
}

/**
 * Request iOS's nonexclusive short-prompt category. `transient` may duck other
 * audio while it continues; older WebKit builds can reject it, so the only
 * fallback is the still-mixable `ambient` category.
 */
export function beginIosSpeechSession(): "transient" | "ambient" | null {
  if (activeRecordingTokens.size > 0) return null;
  const session = iosAudioSession();
  if (!session) return null;
  for (const type of ["transient", "ambient"] as const) {
    try {
      session.type = type;
      if (session.type === type) return type;
    } catch {}
  }
  return null;
}

/** Return a finished prompt to the shared idle category. */
export function endIosSpeechSession(): boolean {
  return requestIosMixableSession();
}

export function isIosRecordingSessionActive(): boolean {
  return activeRecordingTokens.size > 0;
}


export function iosAudioSessionState() {
  const session = iosAudioSession();
  return session ? { type: session.type, state: session.state ?? "unknown" } : null;
}

/** Listen for iOS-level interruptions when the experimental event is exposed. */
export function onIosAudioSessionInterrupted(listener: () => void): () => void {
  const session = iosAudioSession();
  if (!session?.addEventListener) return () => {};
  const onStateChange = () => {
    if (session.state === "interrupted") listener();
  };
  session.addEventListener("statechange", onStateChange);
  return () => session.removeEventListener?.("statechange", onStateChange);
}
