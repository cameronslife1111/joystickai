import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/wav"),
});

const PRIMARY_MODEL = "gpt-4o-transcribe";
const FALLBACK_MODEL = "gpt-4o-mini-transcribe";
/** Split anything longer than this into chunks so long notes never fail. */
export const MAX_CHUNK_SECONDS = 480;
const MAX_ATTEMPTS = 3;

export function extensionFor(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "mp4";
  return "wav";
}

type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
};

/** Minimal RIFF/WAVE header parse. Returns null when the bytes aren't PCM WAV. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data" && fmt) {
      const dataLength = Math.min(size, bytes.length - body);
      if (fmt.bitsPerSample !== 16 || fmt.channels < 1) return null;
      return { ...fmt, dataOffset: body, dataLength };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function wavFromPcm(pcm: Uint8Array, info: WavInfo): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const put = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  const byteRate = info.sampleRate * info.channels * 2;
  put(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, info.channels, true);
  view.setUint32(24, info.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, info.channels * 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Split a WAV recording into <= MAX_CHUNK_SECONDS pieces, each a complete WAV.
 * Non-WAV or unparseable audio is passed through untouched as a single piece.
 */
export function splitWavChunks(bytes: Uint8Array, maxSeconds = MAX_CHUNK_SECONDS): Uint8Array[] {
  const info = parseWav(bytes);
  if (!info) return [bytes];
  const frameSize = info.channels * 2;
  const bytesPerSecond = info.sampleRate * frameSize;
  if (bytesPerSecond <= 0) return [bytes];
  if (info.dataLength <= bytesPerSecond * maxSeconds) return [bytes];
  const chunkBytes = Math.floor((bytesPerSecond * maxSeconds) / frameSize) * frameSize;
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < info.dataLength; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, info.dataLength);
    const pcm = bytes.subarray(info.dataOffset + start, info.dataOffset + end);
    chunks.push(wavFromPcm(pcm, info));
  }
  return chunks;
}

/** Turn a transcription failure into something a person can act on. */
export function transcriptionErrorMessage(status: number, raw: string): string {
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } };
    detail = parsed.error?.message ?? parsed.message ?? raw;
  } catch {}
  if (status === 401 || status === 403) {
    return "Voice typing isn't set up right — the OpenAI key was rejected.";
  }
  if (status === 402 || /quota|billing|insufficient/i.test(detail)) {
    return "Your OpenAI account is out of credit, so the recording couldn't be transcribed.";
  }
  if (status === 429) return "Too many recordings at once — wait a moment and try again.";
  if (status >= 500) return "The transcription service had a hiccup. Please try again.";
  return detail || `Transcription failed (${status})`;
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function transcribeChunk(
  apiKey: string,
  chunk: Uint8Array,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const ext = extensionFor(mimeType);
  let lastError: Error | null = null;
  // Attempts 1-2 use the main model; the last attempt falls back to the cheaper
  // one in case the main model is unavailable for this account.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const model = attempt === MAX_ATTEMPTS ? FALLBACK_MODEL : PRIMARY_MODEL;
    const form = new FormData();
    form.append("file", new Blob([chunk as unknown as BlobPart], { type: mimeType }), `voice.${ext}`);
    form.append("model", model);
    form.append("response_format", "json");
    try {
      const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (res.ok) {
        const json = (await res.json()) as { text?: string };
        return (json.text ?? "").trim();
      }
      const raw = await res.text().catch(() => "");
      lastError = new Error(transcriptionErrorMessage(res.status, raw));
      // Key/credit problems never fix themselves — surface them straight away.
      if (res.status === 401 || res.status === 403 || res.status === 402) throw lastError;
      // Other non-retryable statuses: skip ahead to the fallback model.
      if (!RETRYABLE(res.status) && attempt < MAX_ATTEMPTS) {
        attempt = MAX_ATTEMPTS - 1;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Transcription failed");
      if (error === lastError) throw error;
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt);
  }
  throw lastError ?? new Error("Transcription failed");
}

/** Transcribe a recording with chunking, retries and partial-failure tolerance. */
export async function transcribeRecording(
  apiKey: string,
  bytes: Uint8Array,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string }> {
  const chunks = splitWavChunks(bytes);
  const parts: string[] = [];
  const failures: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const text = await transcribeChunk(apiKey, chunks[i], mimeType, fetchImpl);
      if (text) parts.push(text);
    } catch (err) {
      // A single bad chunk must never throw away the rest of a long recording.
      if (chunks.length === 1) throw err;
      failures.push(i + 1);
    }
  }
  if (parts.length === 0) {
    throw new Error("Nothing could be transcribed from that recording. Please try again.");
  }
  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (failures.length > 0) text += ` [one part of this recording couldn't be transcribed]`;
  return { text };
}

/** Transcribe a recording via OpenAI gpt-4o-transcribe using the project's own key. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error("Voice typing isn't configured — the OpenAI key is missing.");
    }
    const bytes = new Uint8Array(Buffer.from(data.audioBase64, "base64"));
    return transcribeRecording(apiKey, bytes, data.mimeType || "audio/wav");
  });
