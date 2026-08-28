// Server-only shared context builder. Both the typed chat turn and the
// hands-free voice session assemble their context from here, so voice requests
// see exactly what a typed request sees: full attached documents, this thread's
// plan memory, and the recent conversation. Never import from client code.
import { buildPlanMemory } from "./plan-memory";
import { wrapDocumentBlock } from "./assistant-instructions";

/** Supabase Data API caps one query at ~1000 rows. */
const PAGE = 1000;
/** How many recent thread messages make up the server-built transcript. */
export const TRANSCRIPT_MESSAGES = 12;
/** Per-message cap inside the transcript. */
const TRANSCRIPT_MESSAGE_CHARS = 2000;

export type DocumentBlock = {
  /** Document text only (no header), joined newest-first when asked. */
  text: string;
  included: number;
  trimmed: boolean;
};

/**
 * Pull the COMPLETE text of every attached document, paginating so long
 * documents are never silently truncated to their beginning.
 */
export async function buildDocumentBlock(
  supabase: any,
  documentIds: string[],
  opts: { newestFirst?: boolean; maxChars?: number } = {},
): Promise<DocumentBlock> {
  const ids = opts.newestFirst ? [...documentIds].reverse() : [...documentIds];
  if (ids.length === 0) return { text: "", included: 0, trimmed: false };
  const maxChars = opts.maxChars ?? Number.POSITIVE_INFINITY;

  const parts: string[] = [];
  let used = 0;
  let trimmed = false;

  for (const docId of ids) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title")
      .eq("id", docId)
      .single();

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
    if (used + piece.length > maxChars) {
      trimmed = true;
      break;
    }
    used += piece.length;
    parts.push(piece);
  }

  return { text: parts.join("\n\n"), included: parts.length, trimmed };
}

/** Document ids currently attached to a chat thread (server-side truth). */
export async function getThreadDocumentIds(
  supabase: any,
  threadId: string | null | undefined,
): Promise<string[]> {
  if (!threadId) return [];
  const { data } = await supabase
    .from("chat_threads")
    .select("attached_document_ids")
    .eq("id", threadId)
    .maybeSingle();
  return ((data?.attached_document_ids as string[] | null) ?? []).filter(Boolean);
}

/**
 * Recent conversation of a thread, read from the database rather than from
 * whatever the browser happened to have loaded.
 */
export async function buildThreadTranscript(
  supabase: any,
  threadId: string | null | undefined,
  limit = TRANSCRIPT_MESSAGES,
): Promise<string> {
  if (!threadId) return "";
  const { data } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = ((data ?? []) as Array<{ role: string; content: string }>).slice().reverse();
  return rows
    .filter((m) => (m.content ?? "").trim())
    .map(
      (m) =>
        (m.role === "user" ? "User: " : "Orby: ") +
        m.content.trim().slice(0, TRANSCRIPT_MESSAGE_CHARS),
    )
    .join("\n");
}

export type SharedContext = {
  /** Attached documents + plan memory, ready to drop into instructions. */
  block: string;
  /** Recent conversation, server-built. Empty when there is no thread. */
  transcript: string;
  documentsIncluded: number;
  documentsTrimmed: boolean;
};

/**
 * Everything a request — typed or spoken — should know about the user's
 * workspace: attached documents (full text), this thread's plan memory, and
 * the recent conversation.
 */
export async function buildSharedContext(
  supabase: any,
  input: {
    threadId?: string | null;
    documentIds?: string[];
    docMaxChars?: number;
    includeTranscript?: boolean;
  },
): Promise<SharedContext> {
  const documentIds = input.documentIds?.length
    ? input.documentIds
    : await getThreadDocumentIds(supabase, input.threadId);

  const docs = await buildDocumentBlock(supabase, documentIds, {
    newestFirst: true,
    maxChars: input.docMaxChars,
  });

  let memoryBlock = "";
  try {
    const memory = await buildPlanMemory(supabase, input.threadId ?? null, {
      inlineDocs: true,
      excludeDocIds: documentIds,
    });
    memoryBlock = memory.block ?? "";
  } catch (e) {
    console.warn("[assistant-context] plan memory failed", e);
  }

  const transcript =
    input.includeTranscript === false
      ? ""
      : await buildThreadTranscript(supabase, input.threadId);

  const pieces = [wrapDocumentBlock(docs.text), memoryBlock].filter(Boolean);
  return {
    block: pieces.join("\n\n"),
    transcript,
    documentsIncluded: docs.included,
    documentsTrimmed: docs.trimmed,
  };
}
