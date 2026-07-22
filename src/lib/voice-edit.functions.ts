import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";
import { splitIntoSentences } from "./sentences";

function getModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return createOpenAiProvider(apiKey)("gpt-5.5");
}

function tryParseJson<T = unknown>(raw: string): T | null {
  const trimmed = (raw ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body) as T;
  } catch {
    const m = body.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    return null;
  }
}

const schema = z.object({
  documentId: z.string().uuid(),
  transcript: z.string().min(1).max(8000),
  currentSentenceIndex: z.number().int().min(0),
});

type Op =
  | { op: "replace_sentence"; index: number; newText: string }
  | { op: "edit_sentence"; index: number; newText: string }
  | { op: "insert_sentences"; atIndex: number; texts: string[] }
  | { op: "delete_sentences"; indexes: number[] }
  | { op: "move_sentence"; fromIndex: number; toIndex: number }
  | { op: "web_search_and_insert"; query: string; afterIndex: number };

async function perplexitySearch(query: string): Promise<string | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You write concise, well-formed prose to be inserted into a user's document. No headings, no bullets, no citations markup — just clean sentences.",
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function openAiWrite(query: string): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    system:
      "You write concise, well-formed prose to be inserted into a user's document. No headings, no bullets, no citations — just clean sentences.",
    messages: [{ role: "user", content: query }],
  });
  return (text ?? "").trim();
}

/**
 * Voice-driven document editor. Interprets a spoken transcript as a series of
 * edit ops against ONE document and applies them in order.
 */
export const voiceEditDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const [{ data: doc }, sentsRes] = await Promise.all([
      supabase.from("documents").select("id, title").eq("id", data.documentId).maybeSingle(),
      supabase
        .from("sentences")
        .select("id, content, order_index")
        .eq("document_id", data.documentId)
        .order("order_index", { ascending: true }),
    ]);
    if (!doc) throw new Error("Document not found");
    if (sentsRes.error) throw new Error(sentsRes.error.message);

    const sentences = sentsRes.data ?? [];
    const list = sentences.map((s, i) => `${i}: ${s.content}`).join("\n");

    const system =
      "You are a precise voice-controlled document editor. The user is speaking about ONE document and wants you to output a JSON list of edit operations. " +
      "You NEVER chat back — you ONLY return JSON. " +
      "The user is currently ON sentence index " +
      String(data.currentSentenceIndex) +
      ". Interpret 'this sentence', 'here', 'right here' as that index. " +
      "Interpret 'the next sentence' / 'after this' as index+1, 'the previous' as index-1. " +
      'Return strict JSON of the form {"ops":[...]} where each op is one of:\n' +
      '  {"op":"replace_sentence","index":<int>,"newText":"..."}\n' +
      '  {"op":"edit_sentence","index":<int>,"newText":"..."}   // same as replace, for word-level rewrites\n' +
      '  {"op":"insert_sentences","atIndex":<int>,"texts":["...","..."]}   // atIndex is the insert position; existing rows shift down\n' +
      '  {"op":"delete_sentences","indexes":[<int>,...]}\n' +
      '  {"op":"move_sentence","fromIndex":<int>,"toIndex":<int>}\n' +
      '  {"op":"web_search_and_insert","query":"...","afterIndex":<int>}   // fetches info from the web and inserts after the given index\n' +
      "Rules: use pre-edit indexes for every op — the runner reconciles order. Split newText or texts into complete sentences ending with punctuation. Speech-to-text may contain small errors; fuzzy-match sentence content. If unsure, return an empty ops array.";

    const user =
      `Document title: "${doc.title}"\n\nDocument sentences (index: content):\n${list || "(empty)"}\n\n` +
      `User said (raw transcript): "${data.transcript}"\n\nReturn ONLY JSON.`;

    let parsed: { ops?: Op[] } | null = null;
    try {
      const { text } = await generateText({
        model: getModel(),
        system,
        messages: [{ role: "user", content: user }],
      });
      parsed = tryParseJson(text);
    } catch (e) {
      console.error("[voiceEditDocument] AI error", e);
    }
    const ops = (parsed?.ops ?? []).filter((o) => o && typeof (o as any).op === "string");
    if (ops.length === 0) {
      return { appliedCount: 0, focusIndex: data.currentSentenceIndex, opsRun: 0 };
    }

    // Get the caller's user id from the row we already have owner scope on
    // (RLS enforces the join). Re-fetch a fresh sentences list after each
    // mutation so index math stays honest against the actual current state.
    let focusIndex: number | null = null;
    let applied = 0;

    async function refetch() {
      const r = await supabase
        .from("sentences")
        .select("id, content, order_index")
        .eq("document_id", data.documentId)
        .order("order_index", { ascending: true });
      return r.data ?? [];
    }

    let current = sentences.slice();

    for (const op of ops) {
      try {
        if (op.op === "replace_sentence" || op.op === "edit_sentence") {
          if (op.index < 0 || op.index >= current.length) continue;
          const target = current[op.index];
          const { error } = await supabase
            .from("sentences")
            .update({ content: op.newText.trim() })
            .eq("id", target.id);
          if (error) throw new Error(error.message);
          if (focusIndex === null) focusIndex = op.index;
          applied++;
          current = await refetch();
        } else if (op.op === "delete_sentences") {
          const idxs = (op.indexes ?? [])
            .filter((i) => Number.isInteger(i) && i >= 0 && i < current.length)
            .sort((a, b) => b - a);
          if (idxs.length === 0) continue;
          const ids = idxs.map((i) => current[i].id);
          const { error } = await supabase.from("sentences").delete().in("id", ids);
          if (error) throw new Error(error.message);
          if (focusIndex === null) focusIndex = Math.max(0, idxs[idxs.length - 1] - 1);
          applied += ids.length;
          current = await refetch();
        } else if (op.op === "insert_sentences") {
          const pieces = (op.texts ?? [])
            .flatMap((t) => splitIntoSentences(t))
            .filter(Boolean);
          if (pieces.length === 0) continue;
          const at = Math.max(0, Math.min(op.atIndex ?? current.length, current.length));
          const { error } = await supabase.rpc("insert_sentences_at", {
            p_document_id: data.documentId,
            p_contents: pieces,
            p_insert_at: at,
          });
          if (error) throw new Error(error.message);
          if (focusIndex === null) focusIndex = at;
          applied += pieces.length;
          current = await refetch();
        } else if (op.op === "move_sentence") {
          const from = Math.max(0, Math.min(op.fromIndex, current.length - 1));
          const to = Math.max(0, Math.min(op.toIndex, current.length - 1));
          if (from === to) continue;
          const { error } = await supabase.rpc("move_sentence", {
            p_document_id: data.documentId,
            p_from_index: from,
            p_to_index: to,
          });
          if (error) throw new Error(error.message);
          if (focusIndex === null) focusIndex = to;
          applied++;
          current = await refetch();
        } else if (op.op === "web_search_and_insert") {
          const q = (op.query ?? "").trim();
          if (!q) continue;
          const raw = (await perplexitySearch(q)) ?? (await openAiWrite(q));
          const pieces = splitIntoSentences(raw ?? "").filter(Boolean);
          if (pieces.length === 0) continue;
          const at = Math.max(
            0,
            Math.min((op.afterIndex ?? current.length - 1) + 1, current.length),
          );
          const { error } = await supabase.rpc("insert_sentences_at", {
            p_document_id: data.documentId,
            p_contents: pieces,
            p_insert_at: at,
          });
          if (error) throw new Error(error.message);
          if (focusIndex === null) focusIndex = at;
          applied += pieces.length;
          current = await refetch();
        }
      } catch (e) {
        console.error("[voiceEditDocument] op error", op, e);
      }
    }

    return {
      appliedCount: applied,
      focusIndex: focusIndex ?? data.currentSentenceIndex,
      opsRun: ops.length,
    };
  });
