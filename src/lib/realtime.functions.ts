import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  /** Recent conversation so the live call continues naturally. */
  context: z.string().max(20_000).default(""),
});

export const REALTIME_MODEL = "gpt-realtime";
/** Natural American female voice for the hands-free call. */
export const REALTIME_VOICE = "shimmer";

const CALL_RULES =
  "You are Orby, a warm, helpful assistant on a hands-free voice call inside a writing app. " +
  "Speak naturally and conversationally, like a friendly American woman on the phone. Keep answers short " +
  "and easy to listen to — a few sentences unless asked for more. " +
  "This call is TEXT-CONVERSATION ONLY: you cannot run multi-step plans, edit or create documents, " +
  "generate images or videos, search the web, or schedule anything while the call is live. " +
  "If the user asks for any of those, say warmly that they should stop hands-free mode and ask in the chat, " +
  "where you can plan and do the work. " +
  "Never speak markdown: no asterisks, headings, bullet characters or code formatting — just plain spoken language. " +
  "If the user starts talking while you are speaking, stop immediately and listen.";

/**
 * Mint a short-lived OpenAI Realtime client secret so the browser can open a
 * WebRTC voice call without ever seeing OPENAI_API_KEY.
 */
export const createRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }): Promise<{ token: string; model: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const instructions = data.context
      ? `${CALL_RULES}\n\nRecent conversation in this chat thread (continue it naturally):\n${data.context}`
      : CALL_RULES;

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions,
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "semantic_vad", interrupt_response: true },
            },
            output: { voice: REALTIME_VOICE },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[realtime] client_secrets failed [${res.status}]`, body.slice(0, 500));
      throw new Error(`Couldn't start hands-free mode [${res.status}]`);
    }

    const json = (await res.json()) as { value?: string; client_secret?: { value?: string } };
    const token = json.value ?? json.client_secret?.value ?? "";
    if (!token) throw new Error("Couldn't start hands-free mode");
    return { token, model: REALTIME_MODEL };
  });
