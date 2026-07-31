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
    // Try to find first {...} or [...]
    const m = body.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try { return JSON.parse(m[0]) as T; } catch {}
    }
    return null;
  }
}

// ----- resolve documents by voice -----
const resolveSchema = z.object({
  utterance: z.string().min(1).max(2000),
  recentTranscript: z.string().max(8000).optional(),
  expectMultiple: z.boolean().optional(),
  purpose: z.enum(["read", "add", "mark"]).default("read"),
});

export const resolveDocumentsByVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resolveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: docs, error } = await supabase
      .from("documents")
      .select("id, title")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    if (!docs || docs.length === 0) {
      return { matches: [] as Array<{ id: string; title: string; confidence: number }> };
    }

    const list = docs
      .map((d, i) => `${i + 1}. "${d.title}" [id=${d.id}]`)
      .join("\n");

    const system =
      "You are a fuzzy document-title resolver for a voice assistant. " +
      "Given a list of the user's documents and what the user just said on a call, " +
      "pick the document(s) they're referring to. Account for speech-to-text errors, " +
      "phonetic substitutions, and casual paraphrasing. " +
      "Respond ONLY with strict JSON of the form " +
      `{"matches":[{"id":"<uuid>","confidence":0.0-1.0}]}. ` +
      "Return [] if nothing matches confidently (>0.4). " +
      (data.expectMultiple
        ? "The user likely named multiple documents; return all that match."
        : "Return at most one match unless the user clearly listed several.");

    const user =
      `User's documents:\n${list}\n\n` +
      (data.recentTranscript ? `Recent conversation:\n${data.recentTranscript}\n\n` : "") +
      `User just said: "${data.utterance}"\n\n` +
      `Purpose: ${data.purpose}. Return JSON.`;

    let parsed: { matches?: Array<{ id: string; confidence: number }> } | null = null;
    try {
      const { text } = await generateText({
        model: getModel(),
        system,
        messages: [{ role: "user", content: user }],
      });
      parsed = tryParseJson(text);
    } catch (e) {
      console.error("[resolveDocumentsByVoice] AI error", e);
    }

    const raw = parsed?.matches ?? [];
    const byId = new Map(docs.map((d) => [d.id, d.title]));
    const matches = raw
      .filter((m) => m && typeof m.id === "string" && byId.has(m.id))
      .map((m) => ({
        id: m.id,
        title: byId.get(m.id)!,
        confidence: typeof m.confidence === "number" ? m.confidence : 0.5,
      }));

    return { matches };
  });

// ----- read documents (for display + LLM context) -----
const readSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(5),
});

export const readDocumentsForCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => readSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [docsRes, sentsRes] = await Promise.all([
      supabase.from("documents").select("id, title").in("id", data.documentIds),
      supabase
        .from("sentences")
        .select("id, document_id, content, order_index")
        .in("document_id", data.documentIds)
        .order("order_index", { ascending: true }),
    ]);
    if (docsRes.error) throw new Error(docsRes.error.message);
    if (sentsRes.error) throw new Error(sentsRes.error.message);

    const docs = (docsRes.data ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      sentences: (sentsRes.data ?? [])
        .filter((s) => s.document_id === d.id)
        .map((s) => ({ id: s.id, content: s.content, order_index: s.order_index })),
    }));
    return { docs };
  });

// ----- add text to document -----
const addSchema = z.object({
  documentId: z.string().uuid(),
  text: z.string().min(1).max(8000),
});

export const addTextToDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => addSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const pieces = splitIntoSentences(data.text);
    if (pieces.length === 0) return { inserted: 0 };

    // Insert at the end: count first.
    const { count, error: countErr } = await supabase
      .from("sentences")
      .select("id", { count: "exact", head: true })
      .eq("document_id", data.documentId);
    if (countErr) throw new Error(countErr.message);

    const { error } = await supabase.rpc("insert_sentences_at", {
      p_document_id: data.documentId,
      p_contents: pieces,
      p_insert_at: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { inserted: pieces.length };
  });

// ----- mark sentences for deletion -----
const markSchema = z.object({
  documentId: z.string().uuid(),
  utterance: z.string().min(1).max(2000),
});

export const markSentencesForDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => markSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: sents, error } = await supabase
      .from("sentences")
      .select("id, content, order_index")
      .eq("document_id", data.documentId)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    if (!sents || sents.length === 0) return { marked: 0 };

    const list = sents
      .map((s, i) => `${i}: ${s.content}`)
      .join("\n");

    const system =
      "You select which sentences in a document the user wants to mark for deletion " +
      "based on a short spoken request. Match on meaning, allowing for speech-to-text errors. " +
      "Return ONLY strict JSON: " +
      `{"indexes":[<int>,...]} where each int is the 0-based index. Return [] if unsure.`;

    const user =
      `Document sentences:\n${list}\n\n` +
      `User said: "${data.utterance}"\n\nReturn JSON.`;

    let parsed: { indexes?: number[] } | null = null;
    try {
      const { text } = await generateText({
        model: getModel(),
        system,
        messages: [{ role: "user", content: user }],
      });
      parsed = tryParseJson(text);
    } catch (e) {
      console.error("[markSentencesForDeletion] AI error", e);
    }
    const indexes = (parsed?.indexes ?? []).filter(
      (n) => Number.isInteger(n) && n >= 0 && n < sents.length,
    );
    if (indexes.length === 0) return { marked: 0 };

    const ids = indexes.map((i) => sents[i].id);
    const { error: upErr } = await supabase
      .from("sentences")
      .update({ pending_delete: true })
      .in("id", ids);
    if (upErr) throw new Error(upErr.message);
    return { marked: ids.length };
  });

// ----- edit (replace) a sentence's text -----
const editSchema = z.object({
  documentId: z.string().uuid(),
  sentenceIndex: z.number().int().min(0),
  newText: z.string().min(1).max(8000),
});

export const editSentence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => editSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: sents, error } = await supabase
      .from("sentences")
      .select("id, content, order_index")
      .eq("document_id", data.documentId)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    if (!sents || sents.length === 0) return { updated: false };

    const idx = Math.min(data.sentenceIndex, sents.length - 1);
    const target = sents[idx];
    if (!target) return { updated: false };

    const { error: upErr } = await supabase
      .from("sentences")
      .update({ content: data.newText.trim() })
      .eq("id", target.id);
    if (upErr) throw new Error(upErr.message);
    return { updated: true, sentenceIndex: idx };
  });

// ----- rename a document title -----
const renameSchema = z.object({
  documentId: z.string().uuid(),
  newTitle: z.string().min(1).max(300),
});

export const renameDocumentTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => renameSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error: getErr } = await supabase
      .from("documents")
      .select("title")
      .eq("id", data.documentId)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);

    const newTitle = data.newTitle.trim();
    const { error } = await supabase
      .from("documents")
      .update({ title: newTitle })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { oldTitle: doc?.title ?? null, newTitle };
  });
