import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_TTS_VOICE, type TtsVoice } from "@/lib/tts-voices";
import { assertMixableSessionWithRetries, requestIosMixableSession } from "@/lib/audio-session";
import { stopMicForPlayback } from "@/lib/audio-recorder";

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu;

/** Anything that a synthesizer can actually pronounce. */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

const PLAYBACK_SAMPLE_RATE = 24_000;

/**
 * Slightly-brisker-than-normal playback pace applied to every voice.
 * 1.0 is the model default; this stops sentences dragging without sounding rushed.
 */
export const SPEECH_RATE = 1.15;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function cleanForSpeech(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

let audibleSpeaking = false;
let selectedVoice: TtsVoice = DEFAULT_TTS_VOICE;
let audioContext: AudioContext | null = null;
let activeRequest: AbortController | null = null;
let activeSources = new Set<AudioBufferSourceNode>();
let finishTimer: ReturnType<typeof setTimeout> | null = null;
let requestSequence = 0;

// Recovery state: a playback context is only trusted while its audio clock
// provably advances. iOS can hand back a context that reports "running" but
// plays nothing after another app (Voice Memos, a phone call, Siri) seizes
// the audio route — the only cure is a brand-new context.
let contextStale = false;
let lastClockSample: { contextTime: number; wallTime: number } | null = null;
let detachStateListener: (() => void) | null = null;

// Master switch synced from the user's Sound preference. Default OFF until
// preferences load: when Sound is off, speakText must never reach the network,
// so the user is never charged for speech they didn't ask for. Every speech
// path in the app (sentences, chat, plan cues, previews) funnels through
// speakText, so this one gate is a structural guarantee.
let speechEnabled = false;

export function setSpeechEnabled(on: boolean) {
  speechEnabled = on;
  if (!on) cancelSpeech();
}

export function isSpeechEnabled(): boolean {
  return speechEnabled;
}

// Temporary override held while a hands-free voice call is live: the call has
// its own voice, so no other speech path in the app may play (or be billed).
let speechSuppressed = false;

export function setSpeechSuppressed(on: boolean) {
  speechSuppressed = on;
  if (on) cancelSpeech();
}

export function isSpeechSuppressed(): boolean {
  return speechSuppressed;
}

export function setSpeechVoice(voice: TtsVoice) {
  selectedVoice = voice;
}

// Reuse the sign-in token across rapid sentences instead of paying a storage
// round-trip per speak call; re-fetch only when it is about to expire.
let tokenCache: { token: string; expiresAt: number } | null = null;

function cacheToken(token: string, expiresAtSeconds?: number) {
  tokenCache = {
    token,
    expiresAt: expiresAtSeconds ? expiresAtSeconds * 1000 : Date.now() + 5 * 60_000,
  };
}

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 30_000 > now) return tokenCache.token;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token) {
    tokenCache = null;
    return null;
  }
  cacheToken(session.access_token, session.expires_at);
  return tokenCache?.token ?? null;
}

/**
 * Force a fresh session token after a 401. A stale cached token must never
 * wedge speech until the app is reloaded — refresh once and keep going.
 */
async function refreshAccessToken(): Promise<string | null> {
  tokenCache = null;
  try {
    const { data } = await supabase.auth.refreshSession();
    const session = data.session;
    if (!session?.access_token) return null;
    cacheToken(session.access_token, session.expires_at);
    return session.access_token;
  } catch {
    return null;
  }
}

// Decoded PCM for recently used sentences, so Repeat, back-navigation and
// pre-warmed neighbours start instantly with no network and no extra AI
// credits. Clips are also persisted (see speech-clip-store) so a sentence is
// only ever generated once per voice.
const REPLAY_CACHE_LIMIT = 80;
const replayCache = new Map<string, Float32Array<ArrayBuffer>>();

function replayKey(text: string, voice: string) {
  return `${voice}@${SPEECH_RATE}::${text}`;
}

function rememberClip(key: string, samples: Float32Array<ArrayBuffer>, persist = true) {
  replayCache.delete(key);
  replayCache.set(key, samples);
  while (replayCache.size > REPLAY_CACHE_LIMIT) {
    const oldest = replayCache.keys().next().value;
    if (oldest === undefined) break;
    replayCache.delete(oldest);
  }
  if (persist) void saveStoredClip(key, samples).catch(() => {});
}

/** Memory first, then the persistent store. */
async function lookupClip(key: string): Promise<Float32Array<ArrayBuffer> | null> {
  const inMemory = replayCache.get(key);
  if (inMemory) return inMemory;
  const stored = await loadStoredClip(key).catch(() => null);
  if (stored) rememberClip(key, stored, false);
  return stored;
}

/** Test hook: drop cached tokens, replay clips, and the playback context. */
export function resetSpeechCaches() {
  tokenCache = null;
  replayCache.clear();
  cancelPrewarm();
  resetClipStore();
  discardPlaybackContext();
}


/**
 * Mark the current playback engine as untrustworthy. The next speak call
 * discards it and builds a fresh one inside the user's tap gesture, where iOS
 * allows audio to start. Called by the startup watchdog, the statechange
 * listener, and the foreground-return path.
 */
export function markPlaybackContextStale() {
  contextStale = true;
  lastClockSample = null;
}

function discardPlaybackContext() {
  contextStale = false;
  lastClockSample = null;
  const context = audioContext;
  audioContext = null;
  detachStateListener?.();
  detachStateListener = null;
  if (context && context.state !== "closed") {
    try {
      void context.close().catch(() => {});
    } catch {}
  }
}

function attachStateListener(context: AudioContext) {
  detachStateListener?.();
  detachStateListener = null;
  if (typeof context.addEventListener !== "function") return;
  const onStateChange = () => {
    if (audioContext !== context) return;
    const visible =
      typeof document === "undefined" ||
      !document.visibilityState ||
      document.visibilityState === "visible";
    if (context.state !== "running" && visible) {
      // Interrupted while we were looking at it — never trust this engine again.
      markPlaybackContextStale();
    }
  };
  context.addEventListener("statechange", onStateChange);
  detachStateListener = () => {
    try {
      context.removeEventListener("statechange", onStateChange);
    } catch {}
  };
}

function createPlaybackContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  try {
    audioContext = new AudioContextConstructor({ sampleRate: PLAYBACK_SAMPLE_RATE });
  } catch {
    try {
      audioContext = new AudioContextConstructor();
    } catch {
      audioContext = null;
    }
  }
  if (audioContext) attachStateListener(audioContext);
  return audioContext;
}

function isUnrecoverableState(state: string): boolean {
  // iOS leaves contexts in "interrupted" after another app takes the mic (or a
  // call comes in, or the phone sleeps); resume() almost never brings those
  // back. Treat both interrupted and closed as dead.
  return state === "closed" || state === "interrupted";
}

/**
 * A "running" context is only believable if its clock actually advances. When
 * another app seizes the audio route, iOS can leave the context reporting
 * "running" while currentTime stays frozen and nothing comes out of the
 * speaker. Compare the audio clock against the wall clock since the last
 * observation; frozen clock → the engine is wedged and must be replaced.
 */
function isContextClockAlive(context: AudioContext): boolean {
  if (context.state !== "running") return true; // the resume path handles it
  const now = Date.now();
  const sample = lastClockSample;
  lastClockSample = { contextTime: context.currentTime, wallTime: now };
  if (!sample) return true; // first observation — nothing to compare yet
  const wallDelta = now - sample.wallTime;
  const contextDelta = context.currentTime - sample.contextTime;
  // Too little wall time passed to judge → trust it. Otherwise the audio
  // clock must have advanced at all.
  return wallDelta < 750 || contextDelta > 0;
}

const RESUME_ATTEMPT_TIMEOUT_MS = 500;
const RESUME_MAX_ATTEMPTS = 3;

/**
 * Bounded resume: right after an interruption iOS can leave resume() pending
 * forever, which used to hang a sentence silently until the watchdog fired.
 * Race each attempt against a timeout; give up so the caller can recreate.
 */
async function tryResume(context: AudioContext): Promise<boolean> {
  if (context.state === "running") return true;
  for (let attempt = 0; attempt < RESUME_MAX_ATTEMPTS; attempt += 1) {
    try {
      await Promise.race([context.resume(), sleep(RESUME_ATTEMPT_TIMEOUT_MS)]);
    } catch {}
    // resume() mutates state asynchronously — re-read it un-narrowed.
    const state = context.state as AudioContextState;
    if (state === "running") return true;
    if (isUnrecoverableState(state)) return false;
  }
  return (context.state as AudioContextState) === "running";
}

/**
 * Return a playback context that can actually run. Anything suspicious — a
 * stale mark, an unrecoverable state, a frozen audio clock, or a resume that
 * will not complete — means discarding the engine and building a fresh one.
 * Called from speakText this runs inside the user's tap gesture, so iOS lets
 * the fresh context start immediately.
 */
export async function recoverPlaybackContext(): Promise<AudioContext | null> {
  let context = audioContext;
  if (
    contextStale ||
    !context ||
    isUnrecoverableState(context.state) ||
    !isContextClockAlive(context)
  ) {
    discardPlaybackContext();
    context = createPlaybackContext();
  }
  if (!context) return null;
  if (!(await tryResume(context))) {
    discardPlaybackContext();
    context = createPlaybackContext();
    if (context) await tryResume(context);
  }
  if (context && context.state === "running") {
    lastClockSample = { contextTime: context.currentTime, wallTime: Date.now() };
  }
  return context;
}

let recoveryListenersAttached = false;

/**
 * The app was backgrounded and is visible again. iOS ignores resume() outside
 * a user gesture, so don't try to heal the old engine here — retire it. The
 * next orb tap builds a fresh context with a guaranteed clean audio route.
 * Also win the mixable audio-session category back from whatever app just had
 * it, retrying while iOS finishes the handoff.
 */
export function handleAppForeground() {
  cancelSpeech();
  discardPlaybackContext();
  assertMixableSessionWithRetries();
}

function attachForegroundRecovery() {
  if (recoveryListenersAttached) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  recoveryListenersAttached = true;
  const onMaybeForeground = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    handleAppForeground();
  };
  window.addEventListener("pageshow", onMaybeForeground);
  window.addEventListener("focus", onMaybeForeground);
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onMaybeForeground);
  }
}

/**
 * Take the audio route back from any held or dying microphone and assert the
 * mixable iOS category so speech layers over other audio instead of stopping
 * it. Both steps are synchronous property/track operations — zero added latency.
 */
function reclaimAudioRoute() {
  stopMicForPlayback();
  requestIosMixableSession();
}

function emitSpeechError(message: string) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("orby-speech-error", { detail: message }));
    } catch {}
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function cancelSpeech() {
  requestSequence += 1;
  audibleSpeaking = false;
  activeRequest?.abort();
  activeRequest = null;
  if (finishTimer) clearTimeout(finishTimer);
  finishTimer = null;
  activeSources.forEach((source) => {
    try { source.stop(); } catch {}
  });
  activeSources.clear();
}

export function isSpeaking(): boolean {
  return audibleSpeaking;
}

/** Schedule one PCM chunk for immediate playback at SPEECH_RATE. Returns its end time. */
function scheduleSamples(
  context: AudioContext,
  samples: Float32Array<ArrayBuffer>,
  playhead: number,
): number {
  const audioBuffer = context.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE);
  audioBuffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = SPEECH_RATE;
  source.connect(context.destination);
  source.onended = () => activeSources.delete(source);
  activeSources.add(source);
  const startAt = playhead === 0
    ? context.currentTime + 0.04
    : Math.max(playhead, context.currentTime);
  source.start(startAt);
  audibleSpeaking = true;
  // Fresh proof the engine is alive — the liveness baseline for the next speak.
  lastClockSample = { contextTime: context.currentTime, wallTime: Date.now() };
  return startAt + audioBuffer.duration / SPEECH_RATE;
}

type ClipStream = {
  /** Called with each decoded PCM chunk as it arrives (live playback path). */
  onChunk?: (samples: Float32Array<ArrayBuffer>) => void;
  /** Return true to abandon the request (superseded by a newer action). */
  isStale?: () => boolean;
};

/**
 * Request one sentence from hosted Google speech and decode its PCM.
 * Shared by the live speak path (which plays chunks as they arrive) and the
 * prewarm path (which only fills the cache). Returns null when the caller
 * went stale mid-flight; throws with a user-facing message on failure.
 */
async function generateClip(
  clean: string,
  voice: TtsVoice,
  signal: AbortSignal,
  stream: ClipStream = {},
): Promise<Float32Array<ArrayBuffer> | null> {
  const stale = () => stream.isStale?.() === true;

  let bearer = await getAccessToken();
  if (!bearer) throw new Error("Please sign in to use speech.");
  if (stale()) return null;

  const requestSpeech = (tokenValue: string) =>
    fetch("/api/public/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenValue}` },
      body: JSON.stringify({ text: clean, voice }),
      signal,
    });

  let response = await requestSpeech(bearer);

  // Token rejected? Refresh the session once and retry — never wedge.
  if (response.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh && !stale()) {
      bearer = fresh;
      response = await requestSpeech(bearer);
    }
  }

  // One bounded retry for transient gateway failures (429 / 5xx),
  // honoring Retry-After when the gateway sends one.
  if (response.status === 429 || response.status >= 500) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter, 10) * 1_000
      : 1_000;
    await sleep(waitMs);
    if (stale()) return null;
    response = await requestSpeech(bearer);
  }

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Speech request failed (${response.status})`);
  }

  let pending = new Uint8Array(0);
  let buffer = "";
  let completed = false;
  const captured: Float32Array<ArrayBuffer>[] = [];

  const take = (incoming: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0 || stale()) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
    const samples = new Float32Array(usable / 2) as Float32Array<ArrayBuffer>;
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }
    captured.push(samples);
    stream.onChunk?.(samples);
  };
  const processEvent = (raw: string) => {
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: string; audio?: string };
    if (payload.type === "speech.audio.delta" && payload.audio) take(decodeBase64(payload.audio));
    if (payload.type === "speech.audio.done") completed = true;
  };

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    events.forEach(processEvent);
  }
  if (buffer.trim()) processEvent(buffer);
  if (stale()) return null;
  if (!completed || captured.length === 0) {
    throw new Error("Google speech returned no playable audio.");
  }

  const total = captured.reduce((n, chunk) => n + chunk.length, 0);
  const merged = new Float32Array(total) as Float32Array<ArrayBuffer>;
  let offset = 0;
  for (const chunk of captured) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Stream one sentence from hosted Google speech and play its PCM chunks immediately. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  // Sound is off — return before touching tokens, network, or audio so the
  // user is never billed for speech while muted.
  if (!speechEnabled || speechSuppressed) return false;
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  cancelSpeech();
  // The sentence the user is waiting on always gets the bandwidth first.
  cancelPrewarm();
  reclaimAudioRoute();
  attachForegroundRecovery();
  const sequence = requestSequence;
  const key = replayKey(clean, selectedVoice);
  const cachedInMemory = replayCache.get(key) ?? null;

  const controller = new AbortController();
  activeRequest = controller;

  // Watchdog: if nothing has started playing a few seconds after the gesture,
  // reset and say so instead of hanging silently until the app is restarted.
  // Marking the engine stale means the very next swipe gets a fresh context
  // instead of re-failing on the same suspect one.
  const startWatchdog = setTimeout(() => {
    if (sequence !== requestSequence || audibleSpeaking) return;
    if (activeRequest === controller) activeRequest = null;
    markPlaybackContextStale();
    emitSpeechError("Speech couldn't start — please try again");
    opts.onError?.();
  }, 4_000);

  void (async () => {
    try {
      const context = await recoverPlaybackContext();
      if (sequence !== requestSequence) return;
      if (!context) throw new Error("Audio playback is unavailable on this device.");

      // Instant path: audio for this exact sentence + voice is already here,
      // either in memory or persisted from an earlier session / prewarm.
      const cached = cachedInMemory ?? (await lookupClip(key));
      if (sequence !== requestSequence) return;
      if (cached) {
        const endTime = scheduleSamples(context, cached, 0);
        clearTimeout(startWatchdog);
        const remainingMs = Math.max(0, (endTime - context.currentTime) * 1_000);
        finishTimer = setTimeout(() => {
          if (sequence !== requestSequence) return;
          audibleSpeaking = false;
          activeRequest = null;
          opts.onEnd?.();
        }, remainingMs + 30);
        return;
      }

      let playhead = 0;
      let assertedOnFirstChunk = false;
      const merged = await generateClip(clean, selectedVoice, controller.signal, {
        isStale: () => sequence !== requestSequence,
        onChunk: (samples) => {
          if (sequence !== requestSequence) return;
          if (!assertedOnFirstChunk) {
            assertedOnFirstChunk = true;
            clearTimeout(startWatchdog);
            // Re-assert mixable once audio actually starts, catching any late
            // audio-session flip the microphone left behind.
            requestIosMixableSession();
          }
          playhead = scheduleSamples(context, samples, playhead);
        },
      });
      if (!merged || sequence !== requestSequence) return;

      // Cache the decoded clip so Repeat / re-reads replay instantly and free.
      rememberClip(key, merged);

      const remainingMs = Math.max(0, (playhead - context.currentTime) * 1_000);
      finishTimer = setTimeout(() => {
        if (sequence !== requestSequence) return;
        audibleSpeaking = false;
        activeRequest = null;
        opts.onEnd?.();
      }, remainingMs + 30);
    } catch (error) {
      clearTimeout(startWatchdog);
      if (controller.signal.aborted || sequence !== requestSequence) return;
      audibleSpeaking = false;
      activeRequest = null;
      // A failed sentence often means the engine is suspect — make the next
      // swipe rebuild it rather than re-fail the same way.
      markPlaybackContextStale();
      const message = error instanceof Error ? error.message : "Speech could not start.";
      emitSpeechError(message);
      opts.onError?.();
    }
  })();
  return true;
}

// ---------------------------------------------------------------------------
// Prewarm: generate the audio for sentences the user is about to reach, so the
// next orb press plays from cache instead of waiting on the network. Strictly
// opportunistic — never plays audio, never touches the audio route, never
// surfaces an error, and never delays a real speak call.
// ---------------------------------------------------------------------------

let prewarmController: AbortController | null = null;
let prewarmQueue: string[] = [];
let prewarmRunning = false;

export function cancelPrewarm() {
  prewarmQueue = [];
  prewarmController?.abort();
  prewarmController = null;
}

async function runPrewarmQueue() {
  if (prewarmRunning) return;
  prewarmRunning = true;
  try {
    while (prewarmQueue.length > 0) {
      const clean = prewarmQueue.shift();
      if (!clean) continue;
      if (!speechEnabled || speechSuppressed) break;
      const key = replayKey(clean, selectedVoice);
      const existing = await lookupClip(key).catch(() => null);
      if (existing) continue;
      const controller = new AbortController();
      prewarmController = controller;
      try {
        const merged = await generateClip(clean, selectedVoice, controller.signal, {
          isStale: () => controller.signal.aborted,
        });
        if (merged) rememberClip(key, merged);
      } catch {
        // Prewarm failures are invisible by design: the live speak path will
        // report a genuine problem when the user actually asks for audio.
      } finally {
        if (prewarmController === controller) prewarmController = null;
      }
    }
  } finally {
    prewarmRunning = false;
  }
}

/**
 * Queue sentences to generate ahead of the user, nearest-first. Replaces any
 * previously queued set; a live speak call cancels this entirely.
 */
export function prewarmSentences(texts: string[]) {
  if (!speechEnabled || speechSuppressed) return;
  cancelPrewarm();
  const seen = new Set<string>();
  prewarmQueue = texts
    .map((text) => cleanForSpeech(text ?? ""))
    .filter((clean) => {
      if (!clean || !SPEAKABLE_RE.test(clean)) return false;
      if (seen.has(clean)) return false;
      seen.add(clean);
      return !replayCache.has(replayKey(clean, selectedVoice));
    });
  if (prewarmQueue.length > 0) void runPrewarmQueue();
}

/** True when the audio for this sentence is already in memory. */
export function hasCachedClip(text: string): boolean {
  const clean = cleanForSpeech(text ?? "");
  if (!clean) return false;
  return replayCache.has(replayKey(clean, selectedVoice));
}

