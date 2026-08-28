import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";
import { chatTurnSchema, type ChatRoute } from "./chat-types";

export { ACTION_GROUPS, normalizeCapabilities, ALL_CAPS_ON } from "./chat-types";
export type { ChatCapabilities } from "./chat-types";

/**
 * Text-chat path for Orby's threaded chat. Classifies the latest message using
 * the thread's enabled capabilities and either answers directly (conversation,
 * web search, or image analysis) or signals that the request should become an
 * auto-running plan (route "plan"). Attached documents are provided as context.
 *
 * The actual logic lives in chat-core.server.ts so the background scheduler can
 * run the exact same turn for a scheduled chat message.
 */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chatTurnSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ route: ChatRoute; text?: string }> => {
    const { runChatTurn } = await import("./chat-core.server");
    return await runChatTurn(context.supabase, data);
  });


/**
 * Generate a short (2–5 word) title for a chat thread based on the user's first
 * message. Kept off the critical reply path — the client calls this in the
 * background after the first exchange.
 */
const titleSchema = z.object({
  message: z.string().min(1).max(20_000),
});

export const generateThreadTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => titleSchema.parse(input))
  .handler(async ({ data }): Promise<{ title: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.6-sol");

    const { text } = await aiSdkGenerateText({
      model,
      system:
        "You create very short chat titles. Given the user's first message, " +
        "reply with a concise 2–5 word title that captures the topic. " +
        "No quotes, no punctuation at the end, no emoji, Title Case.",
      messages: [{ role: "user", content: data.message }],
    });
    let title = (text ?? "").trim().replace(/^["']|["']$/g, "").slice(0, 60);
    if (!title) title = "New chat";
    return { title };
  });

