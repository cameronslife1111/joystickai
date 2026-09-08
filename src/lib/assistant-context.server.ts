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
 * Keep only the documents that really belong to this user. Callers running with
 * the service-role client (queued chat turns, schedules) bypass row security,
 * so every id that arrived from a client payload has to be checked here before
 * a single word of a document is read.
 */
export async function filterOwnedDocumentIds(
  supabase: any,
  userId: string | null | undefined,
  documentIds: string[],
): Promise<string[]> {
  const ids = (documentIds ?? []).filter(Boolean);
  if (!userId || ids.length === 0) return [];
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) return [];
  const owned = new Set((data ?? []).map((d: any) => d.id as string));
  return ids.filter((id) => owned.has(id));
}

/**
 * Pull the COMPLETE text of every attached document, paginating so long
 * documents are never silently truncated to their beginning.
 *
 * `ownerId` scopes every read to that user — pass it whenever this runs with
 * the service-role client so a stray document id can never be read.
 */
export async function buildDocumentBlock(
  supabase: any,
  documentIds: string[],
  opts: { newestFirst?: boolean; maxChars?: number; ownerId?: string | null } = {},
): Promise<DocumentBlock> {
  const ids = opts.newestFirst ? [...documentIds].reverse() : [...documentIds];
  if (ids.length === 0) return { text: "", included: 0, trimmed: false };
  const maxChars = opts.maxChars ?? Number.POSITIVE_INFINITY;

  const parts: string[] = [];
  let used = 0;
  let trimmed = false;

  for (const docId of ids) {
    let docQuery = supabase.from("documents").select("title").eq("id", docId);
    if (opts.ownerId) docQuery = docQuery.eq("user_id", opts.ownerId);
    const { data: doc } = await docQuery.maybeSingle();
    if (!doc) continue;

    const contents: string[] = [];
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let rowQuery = supabase
        .from("sentences")
        .select("content")
        .eq("document_id", docId);
      if (opts.ownerId) rowQuery = rowQuery.eq("user_id", opts.ownerId);
      const { data: rows, error } = await rowQuery
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
  ownerId?: string | null,
): Promise<string[]> {
  if (!threadId) return [];
  let q = supabase.from("chat_threads").select("attached_document_ids").eq("id", threadId);
  if (ownerId) q = q.eq("user_id", ownerId);
  const { data } = await q.maybeSingle();
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
  ownerId?: string | null,
): Promise<string> {
  if (!threadId) return "";
  let q = supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("thread_id", threadId);
  if (ownerId) q = q.eq("user_id", ownerId);
  const { data } = await q.order("created_at", { ascending: false }).limit(limit);
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
    /** Scope every read to this user (required on service-role paths). */
    ownerId?: string | null;
  },
): Promise<SharedContext> {
  const ownerId = input.ownerId ?? null;
  const documentIds = input.documentIds?.length
    ? input.documentIds
    : await getThreadDocumentIds(supabase, input.threadId, ownerId);

  const docs = await buildDocumentBlock(supabase, documentIds, {
    newestFirst: true,
    maxChars: input.docMaxChars,
    ownerId,
  });

  let memoryBlock = "";
  try {
    const memory = await buildPlanMemory(supabase, input.threadId ?? undefined, {
      inlineDocs: true,
      excludeDocIds: documentIds,
      ownerId,
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
