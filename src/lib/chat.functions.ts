import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const chatMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
});

const schema = z.object({
  messages: z.array(chatMsg).min(1).max(60),
  contextDocumentIds: z.array(z.string().uuid()).max(20).default([]),
  imageUrl: z.string().url().optional(),
  webSearch: z.boolean().default(false),
  analyzeImage: z.boolean().default(false),
});

async function buildContext(
  supabase: any,
  contextDocumentIds: string[],
): Promise<string> {
  if (!contextDocumentIds.length) return "";
  const parts: string[] = [];
  for (const docId of contextDocumentIds) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title")
      .eq("id", docId)
      .single();
    const { data: rows } = await supabase
      .from("sentences")
      .select("content")
      .eq("document_id", docId)
      .order("order_index", { ascending: true });
    const joined = (rows ?? []).map((r: { content: string }) => r.content).join(" ").trim();
    if (joined) {
      parts.push(`[document: "${doc?.title ?? "Untitled"}"]\n${joined}`);
    }
  }
  return parts.join("\n\n");
}

async function runWebSearch(query: string): Promise<{ ok: boolean; text: string }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { ok: false, text: "Web search isn't configured." };
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content:
              "You are Orby, a helpful assistant. Answer the user's question using up-to-date web information. " +
              "Write a clear, conversational answer. You may use light markdown (short paragraphs, occasional bold) but no inline citation markers like [1] and do not paste raw reference lists.",
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("[chat webSearch] perplexity error", res.status, t.slice(0, 300));
      return { ok: false, text: "The web search failed." };
    }
    const result: any = await res.json();
    let text: string = result?.choices?.[0]?.message?.content ?? "";
    text = text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").trim();
    if (!text) return { ok: false, text: "I couldn't find anything on that." };
    return { ok: true, text };
  } catch (e) {
    console.warn("[chat webSearch] failed", e);
    return { ok: false, text: "The web search failed." };
  }
}

/**
 * Text-chat path for Orby's combined Chat view. Routes a message either to
 * Perplexity web search, an OpenAI vision call (when an image is attached and
 * Analyze image is on), or a normal OpenAI chat completion. Attached documents
 * are always provided as context.
 */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const contextText = await buildContext(supabase, data.contextDocumentIds);

    const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
    const latestText = lastUser?.content ?? data.messages[data.messages.length - 1].content;

    // Web search route.
    if (data.webSearch) {
      const query = contextText
        ? `${latestText}\n\nReference material:\n${contextText}`
        : latestText;
      const { ok, text } = await runWebSearch(query);
      if (!ok) throw new Error(text);
      return { text };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You are Orby, a warm, helpful chat assistant inside a writing app. " +
      "Have a natural back-and-forth conversation. Be clear and useful. " +
      "You may use light markdown formatting (paragraphs, bold, and short lists when helpful). " +
      (contextText
        ? "The user has attached one or more documents as context, shown below. Treat them as authoritative reference for the conversation and refer to them by title when helpful.\n\n" +
          contextText +
          "\n\n"
        : "");

    // Vision route — attach the image to the latest user message.
    if (data.analyzeImage && data.imageUrl) {
      const history = data.messages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const { text } = await aiSdkGenerateText({
        model,
        system,
        messages: [
          ...history,
          {
            role: "user",
            content: [
              { type: "text", text: latestText || "Describe this image." },
              { type: "image", image: data.imageUrl },
            ],
          },
        ] as any,
      });
      const out = (text ?? "").trim();
      if (!out) throw new Error("AI returned an empty response");
      return { text: out };
    }

    // Normal chat route.
    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: data.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const out = (text ?? "").trim();
    if (!out) throw new Error("AI returned an empty response");
    return { text: out };
  });
