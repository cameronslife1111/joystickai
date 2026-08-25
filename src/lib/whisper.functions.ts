import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/wav"),
});

/** Transcribe a short audio clip via Lovable AI speech-to-text (openai/gpt-4o-mini-transcribe). */
export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      throw new Error("Transcription is not configured. The app owner needs to enable Lovable AI.");
    }

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
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("response_format", "json");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } };
        message = parsed.message ?? parsed.error?.message ?? raw;
      } catch {}
      throw new Error(message || `Transcription failed (${res.status})`);
    }
    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  });
