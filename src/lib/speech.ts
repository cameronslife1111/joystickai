import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_TTS_VOICE, type TtsVoice } from "@/lib/tts-voices";

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

function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextConstructor({ sampleRate: 24_000 });
  }
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
  return audioContext;
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

/** Stream one sentence from hosted Google speech and play its PCM chunks immediately. */
export function speakText(text: string, opts: SpeakOpts = {}): boolean {
  const clean = cleanForSpeech(text ?? "");
  if (!clean || !SPEAKABLE_RE.test(clean)) return false;

  cancelSpeech();
  const context = ensureAudioContext();
  if (!context) return false;
  const sequence = requestSequence;
  const controller = new AbortController();
  activeRequest = controller;

  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
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
        const audioBuffer = context.createBuffer(1, samples.length, 24_000);
        audioBuffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.onended = () => activeSources.delete(source);
        activeSources.add(source);
        playhead = playhead === 0
          ? context.currentTime + 0.04
          : Math.max(playhead, context.currentTime);
        source.start(playhead);
        playhead += audioBuffer.duration;
        receivedAudio = true;
        audibleSpeaking = true;
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
