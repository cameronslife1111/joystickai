import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const inputSchema = z.object({
  documentId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
});

export const aiContinue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Pull surrounding sentences for context
    const { data: doc } = await supabase
      .from("documents")
      .select("id, title, current_sentence_index")
      .eq("id", data.documentId)
      .single();

    const { data: sentences } = await supabase
      .from("sentences")
      .select("content, order_index")
      .eq("document_id", data.documentId)
      .order("order_index", { ascending: true });

    const contextText = (sentences ?? [])
      .map((s) => s.content)
      .join(" ")
      .slice(-2000);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-3-flash-preview");

    const system =
      "You are Joystick AI, a focused writing companion. The user speaks one short voice prompt at a time. " +
      "Respond with concise, useful prose that fits the document's flow. " +
      "Reply in plain text, no markdown, no lists, no headings. " +
      "Use clear, separable sentences (each ending in . ! or ?). " +
      "Keep total length under ~6 sentences unless the user explicitly asks for more.";

    const user =
      `Document title: ${doc?.title ?? "Untitled"}\n\n` +
      `Existing document so far:\n${contextText || "(empty)"}\n\n` +
      `User said: ${data.prompt}\n\n` +
      `Continue or respond, picking up after the current position.`;

    const { text } = await generateText({
      model,
      system,
      prompt: user,
    });

    return { text };
  });
