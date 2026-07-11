import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const chatMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
});

const capabilities = z.object({
  web_search: z.boolean().default(true),
  image_analysis: z.boolean().default(true),
  planning: z.boolean().default(true),
  image_generation: z.boolean().default(true),
  video_generation: z.boolean().default(true),
  document_editing: z.boolean().default(true),
});

const schema = z.object({
  messages: z.array(chatMsg).min(1).max(60),
  contextDocumentIds: z.array(z.string().uuid()).max(20).default([]),
  imageUrl: z.string().url().optional(),
  capabilities: capabilities.default({
    web_search: true,
    image_analysis: true,
    planning: true,
    image_generation: true,
    video_generation: true,
    document_editing: true,
  }),
});

export type ChatCapabilities = z.infer<typeof capabilities>;

/** The capability groups that make a request "actionable" (needs a plan). */
export const ACTION_GROUPS = [
  "planning",
  "document_editing",
  "image_generation",
  "video_generation",
] as const;

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

    // Pull the COMPLETE document. The Data API caps a single query at ~1000
    // rows, so paginate until every sentence is fetched — otherwise long
    // documents are silently truncated to their beginning.
    const PAGE = 1000;
    const contents: string[] = [];
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: rows, error } = await supabase
        .from("sentences")
        .select("content")
        .eq("document_id", docId)
        .order("order_index", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      const batch = rows ?? [];
      for (const r of batch) contents.push(r.content);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    const joined = contents.join(" ").trim();
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

function tryParseJson<T = any>(raw: string): T | null {
  const t = (raw ?? "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : t;
  try {
    return JSON.parse(body) as T;
  } catch {
    const m = body.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    return null;
  }
}

type ChatRoute = "chat" | "web" | "plan";

/**
 * Decide how to handle the latest user message given the thread's enabled
 * capabilities. Returns one of: "chat" (normal conversation), "web" (web
 * search), or "plan" (an action that should become an auto-running plan).
 */
async function classifyRoute(
  model: any,
  latestText: string,
  recent: string,
  caps: ChatCapabilities,
): Promise<ChatRoute> {
  const actionEnabled = ACTION_GROUPS.some((g) => caps[g]);
  // Nothing actionable and no web search → always chat.
  if (!actionEnabled && !caps.web_search) return "chat";

  const enabled: string[] = [];
  if (caps.web_search) enabled.push("web_search (look up current/factual info online)");
  if (caps.document_editing) enabled.push("document_editing (create/rename docs, add/edit/move/mark sentences)");
  if (caps.image_generation) enabled.push("image_generation (create/edit/remix images to the gallery)");
  if (caps.video_generation) enabled.push("video_generation (make videos to the gallery)");
  if (caps.planning) enabled.push("planning (multi-step tasks combining the above)");

  const system =
    "You are the router for Orby, a writing assistant. Decide how to handle the user's latest message. " +
    "Return STRICT JSON only: {\"route\":\"chat\"|\"web\"|\"plan\"}.\n\n" +
    "Routes:\n" +
    "- chat: normal conversation, questions, explanations, writing help that needs no live web lookup and no changes to the user's documents or media.\n" +
    (caps.web_search
      ? "- web: the user wants current, factual, or real-world info best answered by searching the web.\n"
      : "") +
    (actionEnabled
      ? "- plan: the user wants Orby to DO something to their workspace — create/edit/organize documents or sentences, or generate/edit images or videos, or any multi-step task.\n"
      : "") +
    `Only these capabilities are ENABLED right now: ${enabled.join("; ") || "none"}. ` +
    "Never choose a route whose capability is disabled — fall back to chat instead.";

  try {
    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: [
        {
          role: "user",
          content:
            (recent ? `Recent conversation:\n${recent}\n\n` : "") +
            `Latest message: "${latestText}"\n\nReturn JSON.`,
        },
      ],
    });
    const parsed = tryParseJson<{ route?: string }>(text);
    let route = (parsed?.route ?? "chat") as ChatRoute;
    if (route === "web" && !caps.web_search) route = "chat";
    if (route === "plan" && !actionEnabled) route = "chat";
    if (route !== "chat" && route !== "web" && route !== "plan") route = "chat";
    return route;
  } catch (e) {
    console.warn("[chat classifyRoute] failed", e);
    return "chat";
  }
}

/**
 * Text-chat path for Orby's threaded chat. Classifies the latest message using
 * the thread's enabled capabilities and either answers directly (conversation,
 * web search, or image analysis) or signals that the request should become an
 * auto-running plan (route "plan"). Attached documents are provided as context.
 */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<{ route: ChatRoute; text?: string }> => {
    const { supabase } = context;
    const caps = data.capabilities;
    const contextText = await buildContext(supabase, data.contextDocumentIds);

    const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
    const latestText = lastUser?.content ?? data.messages[data.messages.length - 1].content;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You are Orby, a warm, helpful chat assistant inside a writing app. " +
      "Have a natural back-and-forth conversation. Be clear and useful. " +
      "You may use light markdown formatting (paragraphs, bold, and short lists when helpful). " +
      (contextText
        ? "The user has attached one or more documents as reference. Their full content is appended to the end of the user's latest message. Treat the attached documents as authoritative reference, use their complete content, and refer to them by title when helpful.\n\n"
        : "");

    // Attach documents LAST — after whatever the user typed. The block is
    // appended to the end of the latest user message so the model reads the
    // question first, then the full, freshly-pulled reference documents.
    const docBlock = contextText
      ? `\n\n[Attached documents — authoritative reference]\n${contextText}`
      : "";
    const latestWithDocs = `${latestText}${docBlock}`;

    // Vision route — attach the image to the latest user message (gated by capability).
    if (caps.image_analysis && data.imageUrl) {
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
              { type: "text", text: latestWithDocs || "Describe this image." },
              { type: "image", image: data.imageUrl },
            ],
          },
        ] as any,
      });
      const out = (text ?? "").trim();
      if (!out) throw new Error("AI returned an empty response");
      return { route: "chat", text: out };
    }

    // Decide route with the thread's capabilities.
    const recent = data.messages
      .slice(-6)
      .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content)
      .join("\n");
    const route = await classifyRoute(model, latestText, recent, caps);

    if (route === "plan") {
      // The client creates and auto-runs the plan; nothing to answer here.
      return { route: "plan" };
    }

    if (route === "web") {
      // User question first, then the full attached documents as reference.
      const query = latestWithDocs;
      const { ok, text } = await runWebSearch(query);
      if (!ok) throw new Error(text);
      return { route: "chat", text };
    }

    // Normal chat route — append the documents to the final user message so
    // they come after the user's text, and rebuild fresh on every send.
    const outgoing = data.messages.map((m) => ({ role: m.role, content: m.content }));
    if (docBlock) {
      for (let i = outgoing.length - 1; i >= 0; i--) {
        if (outgoing[i].role === "user") {
          outgoing[i] = { ...outgoing[i], content: `${outgoing[i].content}${docBlock}` };
          break;
        }
      }
    }
    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: outgoing,
    });
    const out = (text ?? "").trim();
    if (!out) throw new Error("AI returned an empty response");
    return { route: "chat", text: out };
  });
