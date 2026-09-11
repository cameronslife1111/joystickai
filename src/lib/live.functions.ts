import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CALL_RULES, composeLiveInstructions, DOC_RULES } from "@/lib/assistant-instructions";

const schema = z.object({
  /** The browser's WebRTC offer. GPT-Live answers it server-side. */
  sdp: z.string().min(1).max(200_000),
  /** Recent conversation fallback, used only when no thread id is available. */
  context: z.string().max(20_000).default(""),
  /** Thread the call belongs to — its documents, memory and history are pulled server-side. */
  threadId: z.string().uuid().nullish(),
  /** Documents attached to the thread — their full text is handed to the model. */
  documentIds: z.array(z.string().uuid()).max(20).default([]),
});

const docsSchema = z.object({
  threadId: z.string().uuid().nullish(),
  documentIds: z.array(z.string().uuid()).max(20).default([]),
});

/**
 * Full-duplex voice model. It runs the conversation only; all reasoning and
 * doing is delegated back to Orby's own backend (the chat turn runner and the
 * planner) through client delegation.
 */
export const LIVE_MODEL = "gpt-live-1";
/** Natural North-American feminine voice. */
export const LIVE_VOICE = "gleam";

export { CALL_RULES, DOC_RULES, composeLiveInstructions };

/** Overall size cap on the attached-document block handed to the live model. */
const MAX_DOC_CHARS = 60_000;

/** Pull the SDP answer out of whatever shape the Live API returns. */
function extractAnswerSdp(payload: unknown, raw: string): string {
  if (typeof payload === "string" && payload.includes("v=0")) return payload;
  const obj = payload as
    | {
        sdp?: string;
        answer?: string | { sdp?: string };
        transport?: { sdp?: string; answer?: string };
        session?: { transport?: { sdp?: string } };
      }
    | null;
  const candidate =
    obj?.sdp ??
    (typeof obj?.answer === "string" ? obj.answer : obj?.answer?.sdp) ??
    obj?.transport?.sdp ??
    obj?.transport?.answer ??
    obj?.session?.transport?.sdp ??
    (raw.includes("v=0") ? raw : "");
  return typeof candidate === "string" ? candidate : "";
}

/**
 * Start a GPT-Live session for the browser. Unlike the old realtime API there
 * is no ephemeral client secret: the browser hands us its SDP offer, we do the
 * exchange with the project key, and only the answer goes back down.
 */
export const createLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<{ sdp: string; model: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const { buildSharedContext } = await import("./assistant-context.server");
    const shared = await buildSharedContext(context.supabase, {
      threadId: data.threadId ?? null,
      documentIds: data.documentIds,
      docMaxChars: MAX_DOC_CHARS,
      ownerId: context.userId,
    });
    const instructions = composeLiveInstructions(
      shared.transcript || data.context,
      shared.block,
    );

    const res = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: LIVE_MODEL,
          instructions,
          audio: { output: { voice: LIVE_VOICE } },
          // Orby is her own backend: reasoning, tools, plans and documents all
          // run through the existing chat turn runner, not a managed model.
          delegation: { type: "client" },
          store: false,
        },
        transport: { type: "webrtc", sdp: data.sdp },
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error(`[live] sessions failed [${res.status}]`, raw.slice(0, 500));
      throw new Error(`Couldn't start hands-free mode [${res.status}]`);
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const sdp = extractAnswerSdp(parsed, raw);
    if (!sdp) {
      console.error("[live] no SDP answer in response", raw.slice(0, 500));
      throw new Error("Couldn't start hands-free mode");
    }
    return { sdp, model: LIVE_MODEL };
  });

/**
 * Rebuild the workspace context block (attached documents + plan memory) so a
 * mid-call attach/remove can be appended to the live session's instructions.
 */
export const buildLiveDocContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => docsSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ block: string; included: number; trimmed: boolean }> => {
      const { buildSharedContext } = await import("./assistant-context.server");
      const shared = await buildSharedContext(context.supabase, {
        threadId: data.threadId ?? null,
        documentIds: data.documentIds,
        docMaxChars: MAX_DOC_CHARS,
        includeTranscript: false,
        ownerId: context.userId,
      });
      return {
        block: shared.block,
        included: shared.documentsIncluded,
        trimmed: shared.documentsTrimmed,
      };
    },
  );
