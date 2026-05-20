import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const chatMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const chatSchema = z.object({
  messages: z.array(chatMsg).min(1).max(60),
});

export const chatWithOrby = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chatSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You are Orby on a live voice call with the user. " +
      "This is a spoken back-and-forth, not a chat window — your reply will be read aloud by a TTS voice. " +
      "Keep replies SHORT: usually 1 sentence, occasionally 2. Conversational, warm, easy to listen to. " +
      "No markdown, no lists, no headings, no emoji, no URLs, no bullet points. " +
      "Ask one focused follow-up question when it helps the user think. " +
      "If the user asks you to make / generate / build / turn this into a plan, acknowledge briefly that you'll generate the plan now — the app will hang up automatically. " +
      "If the user says goodbye or hang up, say a brief farewell and the app will end the call.";

    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: data.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return { text: (text ?? "").trim() };
  });
