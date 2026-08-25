import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_TTS_VOICE, type TtsVoice } from "@/lib/tts-voices";
import { requestIosMixableSession } from "@/lib/audio-session";
import { stopMicForPlayback } from "@/lib/audio-recorder";

type SpeakOpts = {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

/** Anything that a synthesizer can actually pronounce. */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u;

/**
 * Slightly-brisker-than-normal playback pace applied to every voice.
 * 1.0 is the model default; this stops sentences dragging without sounding rushed.
 */
export const SPEECH_RATE = 1.15;

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

export function setSpeechVoice(voice: TtsVoice) {
  selectedVoice = voice;
}

// Reuse the sign-in token across rapid sentences instead of paying a storage
// round-trip per speak call; re-fetch only when it is about to expire.
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 30_000 > now) return tokenCache.token;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token) {
    tokenCache = null;
    return null;
  }
  tokenCache = {
    token: session.access_token,
    expiresAt: session.expires_at ? session.expires_at * 1000 : now + 5 * 60_000,
  };
  return tokenCache.token;
}

// Decoded PCM for the last few spoken sentences, so Repeat / auto-repeat start
// instantly with no network and no extra AI credits. Only sentences the user
// already heard are cached — nothing is pre-generated.
const REPLAY_CACHE_LIMIT = 12;
const replayCache = new Map<string, Float32Array<ArrayBuffer>>();

function replayKey(text: string, voice: string) {
  return `${voice}::${text}`;
}

function rememberClip(key: string, samples: Float32Array<ArrayBuffer>) {
  replayCache.delete(key);
  replayCache.set(key, samples);
  while (replayCache.size > REPLAY_CACHE_LIMIT) {
    const oldest = replayCache.keys().next().value;
    if (oldest === undefined) break;
    replayCache.delete(oldest);
  }
}

/** Test hook: drop cached tokens and replay clips. */
export function resetSpeechCaches() {
  tokenCache = null;
  replayCache.clear();
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextConstructor({ sampleRate: 24_000 });
  }
  // iOS can leave the context suspended/interrupted after the microphone was
  // open; resume so playback is not silently swallowed.
  if (audioContext.state !== "running") void audioContext.resume().catch(() => {});
  return audioContext;
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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("orby-speech-error", { detail: message }));
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
  const audioBuffer = context.createBuffer(1, samples.length, 24_000);
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
  return startAt + audioBuffer.duration / SPEECH_RATE;
}

/** Stream one sentence from hosted Google speech and play its PCM chunks immediately. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  cancelSpeech();
  reclaimAudioRoute();
  const context = ensureAudioContext();
  if (!context) return false;
  const sequence = requestSequence;
  const key = replayKey(clean, selectedVoice);

  // Instant replay path: audio for this exact sentence + voice is already here.
  const cached = replayCache.get(key);
  if (cached) {
    const endTime = scheduleSamples(context, cached, 0);
    const remainingMs = Math.max(0, (endTime - context.currentTime) * 1_000);
    finishTimer = setTimeout(() => {
      if (sequence !== requestSequence) return;
      audibleSpeaking = false;
      activeRequest = null;
      opts.onEnd?.();
    }, remainingMs + 30);
    return true;
  }

  const controller = new AbortController();
  activeRequest = controller;

  void (async () => {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Please sign in to use speech.");

      const response = await fetch("/api/public/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: clean, voice: selectedVoice }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? `Speech request failed (${response.status})`);
      }

      let playhead = 0;
      let pending = new Uint8Array(0);
      let buffer = "";
      let receivedAudio = false;
      let completed = false;
      let assertedOnFirstChunk = false;
      const captured: Float32Array[] = [];
      const schedule = (incoming: Uint8Array) => {
        const bytes = new Uint8Array(pending.length + incoming.length);
        bytes.set(pending);
        bytes.set(incoming, pending.length);
        const usable = bytes.length - (bytes.length % 2);
        pending = bytes.slice(usable);
        if (usable === 0 || sequence !== requestSequence) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
        const samples = new Float32Array(usable / 2);
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = view.getInt16(index * 2, true) / 32_768;
        }
        if (!assertedOnFirstChunk) {
          assertedOnFirstChunk = true;
          // Re-assert mixable once audio actually starts, catching any late
          // audio-session flip the microphone left behind.
          requestIosMixableSession();
        }
        playhead = scheduleSamples(context, samples, playhead);
        captured.push(samples);
        receivedAudio = true;
      };
      const processEvent = (raw: string) => {
        const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) return;
        const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: string; audio?: string };
        if (payload.type === "speech.audio.delta" && payload.audio) schedule(decodeBase64(payload.audio));
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
      if (!completed || !receivedAudio) throw new Error("Google speech returned no playable audio.");

      // Cache the decoded clip so Repeat / auto-repeat replay instantly.
      const total = captured.reduce((n, chunk) => n + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of captured) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      rememberClip(key, merged);

      const remainingMs = Math.max(0, (playhead - context.currentTime) * 1_000);
      finishTimer = setTimeout(() => {
        if (sequence !== requestSequence) return;
        audibleSpeaking = false;
        activeRequest = null;
        opts.onEnd?.();
      }, remainingMs + 30);
    } catch (error) {
      if (controller.signal.aborted || sequence !== requestSequence) return;
      audibleSpeaking = false;
      activeRequest = null;
      const message = error instanceof Error ? error.message : "Speech could not start.";
      emitSpeechError(message);
      opts.onError?.();
    }
  })();
  return true;
}
