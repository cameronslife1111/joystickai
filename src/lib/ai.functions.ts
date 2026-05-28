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
      "You are Orby, a focused writing companion. The user speaks one short voice prompt at a time. " +
      "Respond with concise, useful prose that fits the document's flow. " +
      "Reply in plain text, no markdown, no lists, no headings. " +
      "Use clear, separable sentences (each ending in . ! or ?). " +
      "Keep total length under ~6 sentences unless the user explicitly asks for more. " +
      "If you reference any URL, include the full http:// or https:// URL inline in the sentence; do not wrap it in markdown link syntax.";

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
  prompt: z.string().min(1).max(100000),
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
      "You are Orby, a focused writing companion. The user gives you a prompt and optional reference documents. " +
      "Respond with concise, useful prose that fits naturally into the user's writing. " +
      "Plain text only — no markdown, no lists, no headings. " +
      "Use clear, separable sentences each ending in . ! or ?. " +
      "Keep total length under ~10 sentences unless the user explicitly asks for more. " +
      "If you reference any URL, include the full http:// or https:// URL inline in the sentence; do not wrap it in markdown link syntax.";

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

const analyzeImageSchema = z.object({
  prompt: z.string().max(100000).default(""),
  imageUrl: z.string().url(),
  contextDocumentIds: z.array(z.string().uuid()).max(20).default([]),
  targetDocumentId: z.string().uuid(),
  position: z.enum(["top", "bottom", "after_current"]),
});

export const analyzeImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => analyzeImageSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const parts: string[] = [];
    const trimmedPrompt = data.prompt.trim();
    if (trimmedPrompt) {
      parts.push(trimmedPrompt);
    } else {
      parts.push("Describe what you see in this image in clear, useful prose.");
    }
    for (const docId of data.contextDocumentIds) {
      const { data: rows } = await supabase
        .from("sentences")
        .select("content")
        .eq("document_id", docId)
        .order("order_index", { ascending: true });
      const joined = (rows ?? []).map((r) => r.content).join(" ").trim();
      if (joined) parts.push(joined);
    }
    const textPart = parts.join("\n\n");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You are Orby, a focused writing companion. The user provides an image and optional context. " +
      "Look at the image carefully and respond in concise, useful prose that fits naturally into the user's writing. " +
      "Plain text only — no markdown, no lists, no headings. " +
      "Use clear, separable sentences each ending in . ! or ?. " +
      "Keep total length under ~10 sentences unless the user explicitly asks for more. " +
      "If you reference any URL, include the full http:// or https:// URL inline in the sentence; do not wrap it in markdown link syntax.";

    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: textPart },
            { type: "image", image: data.imageUrl },
          ],
        },
      ],
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

const webSearchSchema = z.object({
  prompt: z.string().min(1).max(100000),
  contextDocumentIds: z.array(z.string().uuid()).max(20).default([]),
  targetDocumentId: z.string().uuid(),
  position: z.enum(["top", "bottom", "after_current"]),
});

export const webSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => webSearchSchema.parse(input))
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
    const userInput = parts.join("\n\n");

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error("Missing PERPLEXITY_API_KEY");

    const res = await fetch("https://api.perplexity.ai/v1/agent", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preset: "pro-search",
        input: userInput,
        tools: [{ type: "web_search" }],
        instructions:
          "You are Orby, a focused writing companion. The user is researching a topic and your reply will be inserted directly into their document. " +
          "Use web_search to find current, accurate information when relevant. " +
          "Respond in concise, useful prose. Plain text only — no markdown, no lists, no headings, no inline citation numbers like [1] or footnote markers. " +
          "Use clear, separable sentences each ending in . ! or ?. " +
          "Keep total length under ~10 sentences unless the user explicitly asks for more. " +
          "If you reference any URL, include the full http:// or https:// URL inline in the sentence; do not wrap it in markdown link syntax.",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Perplexity ${res.status}: ${errText.slice(0, 400)}`);
    }

    const result: any = await res.json();

    let text = "";
    if (Array.isArray(result?.output)) {
      for (const item of result.output) {
        if (item?.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.type === "output_text" && typeof c.text === "string") {
              text += c.text;
            }
          }
        }
      }
    }
    text = text.trim();
    if (!text) {
      throw new Error("Perplexity returned an empty response");
    }

    text = text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\s+/g, " ").trim();

    const newSentences = splitIntoSentences(text);
    if (newSentences.length === 0) {
      throw new Error("Could not parse a sentence from the response");
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
