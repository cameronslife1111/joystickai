import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

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
    const m = body.match(/[[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    return null;
  }
}

const ACTIONS = [
  "jump",
  "open_doc",
  "find_doc",
  "read_doc",
  "edit_sentence",
  "add_text",
  "mark_delete",
  "rename_title",
  "chat",
  "end_call",
] as const;

const ctxSentence = z.object({ index: z.number(), content: z.string().max(2000) });

const schema = z.object({
  utterance: z.string().min(1).max(2000),
  recentTranscript: z.string().max(8000).optional(),
  activeDocTitle: z.string().max(500).optional(),
  activeDocIndex: z.number().optional(),
  activeSentences: z.array(ctxSentence).max(400).optional(),
});

export type InterpretedCommand = {
  action: (typeof ACTIONS)[number];
  useActiveDoc: boolean;
  docQuery: string | null;
  sentenceIndex: number | null;
  newText: string | null;
  speech: string | null;
};

/**
 * Voice command router for Orby's live call. Classifies a spoken utterance into
 * a structured action against the user's documents/sentences. Resolves sentence
 * targets against the currently-open document when possible.
 */
export const interpretCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }): Promise<InterpretedCommand> => {
    const fallback: InterpretedCommand = {
      action: "chat",
      useActiveDoc: false,
      docQuery: null,
      sentenceIndex: null,
      newText: null,
      speech: null,
    };

    const sentenceList = (data.activeSentences ?? [])
      .slice(0, 400)
      .map((s) => `${s.index}: ${s.content}`)
      .join("\n");

    const system =
      "You are the command router for Orby, a voice assistant on a live call. " +
      "The user speaks; you decide what app action they intend. The app shows ONE document at a time " +
      "(the 'active document') with a list of sentences and a current sentence cursor. " +
      "Classify the utterance into exactly one action and return STRICT JSON only.\n\n" +
      "Actions:\n" +
      "- jump: move the cursor to a specific sentence in the ACTIVE document. Set sentenceIndex (0-based) by matching the user's reference (ordinal like 'sentence 5' => index 4, or meaning like 'the one about taxes'). Set useActiveDoc true.\n" +
      "- open_doc: switch the app to a different document. Set docQuery to the spoken title/description.\n" +
      "- find_doc: the user is trying to recall/confirm a document's name. Set docQuery.\n" +
      "- read_doc: the user wants Orby to read/pull up a document's contents (often to answer a question). Set docQuery, or useActiveDoc true if they mean the current one.\n" +
      "- edit_sentence: change/replace the wording of an existing sentence in the ACTIVE document. Set sentenceIndex (default to the current cursor if they say 'this sentence') and newText (the replacement text only).\n" +
      "- add_text: add new text to a document. Set newText (the content to add, stripped of command framing). Set useActiveDoc true if no other doc named, else docQuery for the target doc.\n" +
      "- mark_delete: mark sentence(s) for deletion. Set useActiveDoc true (or docQuery) — the app resolves which sentences from the utterance.\n" +
      "- rename_title: rename a document's title. Set newText (the new title). useActiveDoc true unless another doc is named (docQuery).\n" +
      "- chat: normal conversation / question that needs no app action.\n" +
      "- end_call: the user says goodbye / hang up / stop.\n\n" +
      "Rules: account for speech-to-text errors and casual phrasing. If the user says 'jump to', 'go to', 'move to' a sentence, use jump. " +
      "If they say 'put/add this in <doc>', use add_text with docQuery. Only set sentenceIndex when confident; otherwise null. " +
      'JSON shape: {"action":"...","useActiveDoc":bool,"docQuery":string|null,"sentenceIndex":number|null,"newText":string|null}';

    const user =
      (data.activeDocTitle
        ? `Active document: "${data.activeDocTitle}" (cursor at sentence index ${data.activeDocIndex ?? 0}).\n`
        : "No document is currently open.\n") +
      (sentenceList ? `Active document sentences (index: text):\n${sentenceList}\n\n` : "\n") +
      (data.recentTranscript ? `Recent conversation:\n${data.recentTranscript}\n\n` : "") +
      `User just said: "${data.utterance}"\n\nReturn JSON.`;

    let parsed: Partial<InterpretedCommand> & { action?: string } = {};
    try {
      const { text } = await generateText({
        model: getModel(),
        system,
        messages: [{ role: "user", content: user }],
      });
      parsed = tryParseJson(text) ?? {};
    } catch (e) {
      console.error("[interpretCommand] AI error", e);
      return fallback;
    }

    const action = ACTIONS.includes(parsed.action as never)
      ? (parsed.action as InterpretedCommand["action"])
      : "chat";

    return {
      action,
      useActiveDoc: parsed.useActiveDoc === true,
      docQuery:
        typeof parsed.docQuery === "string" && parsed.docQuery.trim()
          ? parsed.docQuery.trim()
          : null,
      sentenceIndex:
        typeof parsed.sentenceIndex === "number" && Number.isInteger(parsed.sentenceIndex)
          ? parsed.sentenceIndex
          : null,
      newText:
        typeof parsed.newText === "string" && parsed.newText.trim()
          ? parsed.newText.trim()
          : null,
      speech: null,
    };
  });
