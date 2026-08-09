import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/wav"),
});

/** Terms Orby hears constantly — helps the model spell them correctly. */
const KEYWORDS = [
  "Orby",
  "Cameron",
  "sentence",
  "document",
  "gallery",
  "remix",
  "delegate",
  "plan",
];

const CONTEXT_PROMPT =
  "A person dictating notes, to-do items, ideas and short instructions into a personal writing app.";

/** Transcribe a short audio clip via OpenAI GPT-Transcribe. */
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

    const buildForm = () => {
      const form = new FormData();
      form.append("file", blob, `voice.${ext}`);
      form.append("model", "gpt-transcribe");
      form.append("response_format", "json");
      form.append("prompt", CONTEXT_PROMPT);
      form.append("languages", JSON.stringify(["en"]));
      form.append("keywords", JSON.stringify(KEYWORDS));
      return form;
    };

    let lastError = "";
    // Retry once on a transient upstream/network failure before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: buildForm(),
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : "network error";
        continue;
      }

      if (res.ok) {
        const json = (await res.json()) as { text?: string };
        return { text: (json.text ?? "").trim() };
      }

      const body = await res.text().catch(() => "");
      lastError = `[${res.status}]: ${body.slice(0, 400)}`;
      // 4xx errors are deterministic — no point retrying.
      if (res.status < 500 && res.status !== 429) break;
    }

    throw new Error(`Transcription failed ${lastError}`);
  });
