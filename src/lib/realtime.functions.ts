import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CALL_RULES,
  composeRealtimeInstructions,
  DOC_RULES,
} from "@/lib/assistant-instructions";

const schema = z.object({
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
 * Cheaper mini realtime voice model for hands-free calls. Typed chat, planning
 * and everything else stay on gpt-5.6-sol, so ending a call returns to sol.
 */
export const REALTIME_MODEL = "gpt-realtime-2.1-mini";
/** Natural American female voice for the hands-free call. */
export const REALTIME_VOICE = "shimmer";

export { CALL_RULES, DOC_RULES, composeRealtimeInstructions };

/** Overall size cap on the attached-document block handed to the realtime model. */
const MAX_DOC_CHARS = 60_000;

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

    const { buildSharedContext } = await import("./assistant-context.server");
    const shared = await buildSharedContext(context.supabase, {
      threadId: data.threadId ?? null,
      documentIds: data.documentIds,
      docMaxChars: MAX_DOC_CHARS,
    });
    // Prefer the server-built transcript; fall back to what the client had.
    const instructions = composeRealtimeInstructions(
      shared.transcript || data.context,
      shared.block,
    );

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
              // Near-field reduction keeps speaker bleed and room noise from
              // opening a turn (which made Orby reply to herself).
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                interrupt_response: true,
              },
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
 * Rebuild the workspace context block (attached documents + plan memory), for
 * pushing a mid-call session.update when the user attaches or removes a
 * document. The live rolling transcript stays client-side.
 */
export const buildRealtimeDocContext = createServerFn({ method: "POST" })
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
      });
      return {
        block: shared.block,
        included: shared.documentsIncluded,
        trimmed: shared.documentsTrimmed,
      };
    },
  );
