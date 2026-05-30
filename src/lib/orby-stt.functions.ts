import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  // base64-encoded audio (no data: prefix)
  audioBase64: z.string().min(16).max(20_000_000),
  mimeType: z.string().min(3).max(100).default("audio/webm"),
});

/**
 * Transcribe a short spoken utterance with OpenAI's Whisper-family model.
 * The client records mic audio, segments it on silence (VAD), and sends each
 * segment here. We keep TTS on the device; this is STT only.
 */
export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength < 1200) {
      // Too tiny to be real speech.
      return { text: "" };
    }

    const ext = data.mimeType.includes("mp4")
      ? "mp4"
      : data.mimeType.includes("ogg")
        ? "ogg"
        : data.mimeType.includes("wav")
          ? "wav"
          : "webm";
    const file = new File([bytes], `clip.${ext}`, { type: data.mimeType });

    const form = new FormData();
    form.append("file", file);
    form.append("model", "gpt-4o-transcribe");
    form.append("language", "en");
    form.append("response_format", "json");

    try {
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("[transcribeAudio] OpenAI error", res.status, body);
        return { text: "", error: `Transcription failed (${res.status})` };
      }
      const json = (await res.json()) as { text?: string };
      return { text: (json.text ?? "").trim() };
    } catch (e) {
      console.error("[transcribeAudio] request failed", e);
      return { text: "", error: "Transcription service unavailable" };
    }
  });
