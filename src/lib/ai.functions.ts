import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";
import { splitIntoSentences } from "./sentences";

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

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

    const { text } = await aiSdkGenerateText({
      model,
      system,
      prompt: user,
    });

    return { text };
  });

const generateTextSchema = z.object({
  prompt: z.string().min(1).max(8000),
  contextDocumentIds: z.array(z.string().uuid()).max(20).default([]),
  targetDocumentId: z.string().uuid(),
  position: z.enum(["top", "bottom", "after_current"]),
});

export const generateText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateTextSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const parts: string[] = [];
    if (data.prompt.trim()) parts.push(data.prompt.trim());
    for (const docId of data.contextDocumentIds) {
      const { data: rows } = await supabase
        .from("sentences")
        .select("content")
        .eq("document_id", docId)
        .order("order_index", { ascending: true });
      const joined = (rows ?? []).map((r) => r.content).join(" ").trim();
      if (joined) parts.push(joined);
    }
    const userPrompt = parts.join("\n\n");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You are Joystick AI, a focused writing companion. The user gives you a prompt and optional reference documents. " +
      "Respond with concise, useful prose that fits naturally into the user's writing. " +
      "Plain text only — no markdown, no lists, no headings. " +
      "Use clear, separable sentences each ending in . ! or ?. " +
      "Keep total length under ~10 sentences unless the user explicitly asks for more.";

    const { text } = await aiSdkGenerateText({
      model,
      system,
      prompt: userPrompt,
    });

    if (!text || !text.trim()) {
      throw new Error("AI returned an empty response");
    }

    const newSentences = splitIntoSentences(text);
    if (newSentences.length === 0) {
      throw new Error("Could not parse a sentence from the AI response");
    }

    let insertAt = 0;
    if (data.position === "top") {
      insertAt = 0;
    } else if (data.position === "bottom") {
      const { count } = await supabase
        .from("sentences")
        .select("id", { count: "exact", head: true })
        .eq("document_id", data.targetDocumentId);
      insertAt = count ?? 0;
    } else {
      const { data: doc } = await supabase
        .from("documents")
        .select("current_sentence_index")
        .eq("id", data.targetDocumentId)
        .single();
      const cur = typeof doc?.current_sentence_index === "number" ? doc.current_sentence_index : -1;
      insertAt = cur + 1;
    }

    const { error: rpcErr } = await supabase.rpc("insert_sentences_at", {
      p_document_id: data.targetDocumentId,
      p_contents: newSentences,
      p_insert_at: insertAt,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return {
      insertedCount: newSentences.length,
      insertAt,
      targetDocumentId: data.targetDocumentId,
    };
  });
