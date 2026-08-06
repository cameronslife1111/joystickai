import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  /** Recent conversation so the live call continues naturally. */
  context: z.string().max(20_000).default(""),
  /** Documents attached to the thread — their full text is handed to the model. */
  documentIds: z.array(z.string().uuid()).max(20).default([]),
});

const docsSchema = z.object({
  documentIds: z.array(z.string().uuid()).max(20).default([]),
});

export const REALTIME_MODEL = "gpt-realtime";
/** Natural American female voice for the hands-free call. */
export const REALTIME_VOICE = "shimmer";

export const CALL_RULES =
  "You are Orby, a warm, helpful assistant on a hands-free voice call inside a writing app. " +
  "Speak naturally and conversationally, like a friendly American woman on the phone. Keep answers short " +
  "and easy to listen to — a few sentences unless asked for more. " +
  "This call is TEXT-CONVERSATION ONLY: you cannot run multi-step plans, edit or create documents, " +
  "generate images or videos, search the web, or schedule anything while the call is live. " +
  "If the user asks for any of those, say warmly that they should stop hands-free mode and ask in the chat, " +
  "where you can plan and do the work. " +
  "Never speak markdown: no asterisks, headings, bullet characters or code formatting — just plain spoken language. " +
  "If the user starts talking while you are speaking, stop immediately and listen.";

const DOC_RULES =
  "The user has attached the documents below to this conversation. You can read, quote, summarize and " +
  "discuss them freely out loud, but you cannot change them while the call is live. " +
  "The attached set can change mid-call: always use the list you were most recently given.";

/** Overall size cap on the attached-document block handed to the realtime model. */
const MAX_DOC_CHARS = 60_000;

/**
 * Compose the ATTACHED DOCUMENTS block for a hands-free call. Newest
 * attachments come first so the most recently attached doc always survives
 * trimming.
 */
async function buildDocBlock(
  supabase: any,
  documentIds: string[],
): Promise<{ block: string; included: number; trimmed: boolean }> {
  const ids = [...documentIds].reverse();
  if (ids.length === 0) return { block: "", included: 0, trimmed: false };

  const parts: string[] = [];
  let used = 0;
  let trimmed = false;

  for (const docId of ids) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title")
      .eq("id", docId)
      .single();

    // The Data API caps a single query at ~1000 rows — paginate so long
    // documents aren't silently truncated to their beginning.
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
    if (!joined) continue;
    const piece = `[document: "${doc?.title ?? "Untitled"}"]\n${joined}`;
    if (used + piece.length > MAX_DOC_CHARS) {
      trimmed = true;
      break;
    }
    used += piece.length;
    parts.push(piece);
  }

  if (parts.length === 0) return { block: "", included: 0, trimmed };
  return {
    block: `ATTACHED DOCUMENTS\n${DOC_RULES}\n\n${parts.join("\n\n")}`,
    included: parts.length,
    trimmed,
  };
}

/** Client and server build the session instructions the exact same way. */
export function composeRealtimeInstructions(context: string, docBlock: string): string {
  let out = CALL_RULES;
  if (docBlock) out += `\n\n${docBlock}`;
  if (context) out += `\n\nRecent conversation in this chat thread (continue it naturally):\n${context}`;
  return out;
}

/**
 * Mint a short-lived OpenAI Realtime client secret so the browser can open a
 * WebRTC voice call without ever seeing OPENAI_API_KEY.
 */
export const createRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<{ token: string; model: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const { block } = await buildDocBlock(context.supabase, data.documentIds);
    const instructions = composeRealtimeInstructions(data.context, block);

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

/**
 * Rebuild just the attached-document block, for pushing a mid-call
 * session.update when the user attaches or removes a document.
 */
export const buildRealtimeDocContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => docsSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ block: string; included: number; trimmed: boolean }> => {
      return await buildDocBlock(context.supabase, data.documentIds);
    },
  );
