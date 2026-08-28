import { describe, expect, test } from "bun:test";

import {
  buildDocumentBlock,
  buildSharedContext,
  buildThreadTranscript,
  getThreadDocumentIds,
} from "../src/lib/assistant-context.server";
import {
  CALL_RULES,
  composeRealtimeInstructions,
  DOC_RULES,
  ORBY_BASE_RULES,
} from "../src/lib/assistant-instructions";
import { buildVerbatimPrompt } from "../src/lib/tts-gateway.server";

type Row = Record<string, any>;

/**
 * Minimal Supabase Data API stand-in covering the query shapes the shared
 * context builder uses (documents, sentences, chat_threads, chat_messages, plans).
 */
function fakeSupabase(db: {
  documents: Row[];
  sentences: Row[];
  threads: Row[];
  messages: Row[];
}) {
  return {
    from(table: string) {
      let rows: Row[] =
        table === "documents"
          ? db.documents
          : table === "sentences"
            ? db.sentences
            : table === "chat_threads"
              ? db.threads
              : table === "chat_messages"
                ? db.messages
                : [];
      const api: any = {
        select: () => api,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return api;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          const dir = opts?.ascending === false ? -1 : 1;
          rows = [...rows].sort((a, b) => (a[col] > b[col] ? dir : a[col] < b[col] ? -dir : 0));
          return api;
        },
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return api;
        },
        range: (from: number, to: number) =>
          Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return api;
    },
  };
}

const THREAD = "11111111-1111-1111-1111-111111111111";
const DOC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeDb(attached: string[]) {
  return {
    documents: [
      { id: DOC_A, title: "Garden Plan" },
      { id: DOC_B, title: "Budget Notes" },
    ],
    sentences: [
      { document_id: DOC_A, order_index: 0, content: "Plant the roses in April." },
      { document_id: DOC_A, order_index: 1, content: "Water them twice a week." },
      { document_id: DOC_B, order_index: 0, content: "Soil costs forty dollars." },
    ],
    threads: [{ id: THREAD, attached_document_ids: attached }],
    messages: [
      { thread_id: THREAD, role: "user", content: "What's in the garden plan?", created_at: "1" },
      { thread_id: THREAD, role: "assistant", content: "Roses in April.", created_at: "2" },
    ],
  };
}

describe("text and voice see the same context", () => {
  test("attached documents reach both paths with identical full text", async () => {
    const sb = fakeSupabase(makeDb([DOC_A, DOC_B]));

    // Typed chat path: buildDocumentBlock is what chat-core appends to the message.
    const typed = await buildDocumentBlock(sb, [DOC_B, DOC_A], { newestFirst: true });
    // Voice path: the same builder, wrapped into the call instructions.
    const shared = await buildSharedContext(sb, { threadId: THREAD, documentIds: [DOC_B, DOC_A] });
    const instructions = composeRealtimeInstructions(shared.transcript, shared.block);

    expect(typed.included).toBe(2);
    for (const fragment of [
      'document: "Garden Plan"',
      'document: "Budget Notes"',
      "Plant the roses in April. Water them twice a week.",
      "Soil costs forty dollars.",
    ]) {
      expect(typed.text).toContain(fragment);
      expect(instructions).toContain(fragment);
    }
    expect(shared.documentsIncluded).toBe(2);
  });

  test("removing a document removes it from both paths", async () => {
    const sb = fakeSupabase(makeDb([DOC_A]));
    const typed = await buildDocumentBlock(sb, [DOC_A]);
    const shared = await buildSharedContext(sb, { threadId: THREAD });
    const instructions = composeRealtimeInstructions(shared.transcript, shared.block);

    expect(typed.text).not.toContain("Budget Notes");
    expect(instructions).not.toContain("Budget Notes");
    expect(instructions).toContain("Garden Plan");
  });

  test("thread attachments and history are read server-side", async () => {
    const sb = fakeSupabase(makeDb([DOC_B]));
    expect(await getThreadDocumentIds(sb, THREAD)).toEqual([DOC_B]);

    const transcript = await buildThreadTranscript(sb, THREAD);
    expect(transcript).toBe("User: What's in the garden plan?\nOrby: Roses in April.");

    const shared = await buildSharedContext(sb, { threadId: THREAD });
    expect(shared.transcript).toBe(transcript);
    const instructions = composeRealtimeInstructions(shared.transcript, shared.block);
    expect(instructions).toContain("What's in the garden plan?");
    expect(instructions).toContain("Roses in April.");
  });

  test("no thread and no documents yields no context block", async () => {
    const sb = fakeSupabase(makeDb([]));
    const shared = await buildSharedContext(sb, { threadId: null, documentIds: [] });
    expect(shared.block).toBe("");
    expect(shared.transcript).toBe("");
  });
});

describe("voice instructions reuse the shared rules", () => {
  test("call rules extend the base Orby rules and keep call-only limits", () => {
    expect(CALL_RULES.startsWith(ORBY_BASE_RULES)).toBe(true);
    expect(CALL_RULES).toContain("TEXT-CONVERSATION ONLY");
    expect(CALL_RULES).toContain("hands-free voice call");
  });

  test("attached-document rules tell the model the docs are already in context", async () => {
    const sb = fakeSupabase(makeDb([DOC_A]));
    const shared = await buildSharedContext(sb, { threadId: THREAD });
    const instructions = composeRealtimeInstructions("", shared.block);
    expect(instructions).toContain(DOC_RULES);
    expect(DOC_RULES).toContain("never ask the user to find, open, paste or re-send them");
  });
});

describe("speech steering stays verbatim but natural", () => {
  test("keeps the verbatim contract", () => {
    const prompt = buildVerbatimPrompt("Hello there.");
    expect(prompt).toContain("exactly as written");
    expect(prompt).toContain("Do not answer it");
    expect(prompt).toContain("remove, repeat or change any words");
  });

  test("asks for natural delivery, not word-by-word", () => {
    const prompt = buildVerbatimPrompt("Hello there.");
    expect(prompt).toContain("flowing sentence rhythm");
    expect(prompt).toContain("never pause between individual words");
    expect(prompt).not.toContain("word for word");
  });

  test("passes the sentence through unchanged", () => {
    const sentence = "Water the roses, then check the soil pH.";
    expect(buildVerbatimPrompt(sentence).endsWith(sentence)).toBe(true);
  });
});
