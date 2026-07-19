import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/wav"),
});

/** Transcribe a short audio clip via OpenAI Whisper (gpt-4o-transcribe). */
export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    // Decode the base64 payload into a Blob for multipart upload.
    const binary = Buffer.from(data.audioBase64, "base64");
    const ext = data.mimeType.includes("wav")
      ? "wav"
      : data.mimeType.includes("mp3")
        ? "mp3"
        : data.mimeType.includes("webm")
          ? "webm"
          : data.mimeType.includes("mp4")
            ? "mp4"
            : "wav";
    const blob = new Blob([binary], { type: data.mimeType });

    const form = new FormData();
    form.append("file", blob, `voice.${ext}`);
    form.append("model", "gpt-4o-transcribe");
    form.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Transcription failed [${res.status}]: ${body.slice(0, 400)}`);
    }
    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  });
