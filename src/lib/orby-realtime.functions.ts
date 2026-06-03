import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Orby live call — OpenAI Realtime API (gpt-realtime) over WebRTC.
 *
 * This server fn mints a short-lived ephemeral client secret that the browser
 * uses to open a WebRTC peer connection directly with OpenAI. The real
 * OPENAI_API_KEY never leaves the server. The full session config (model,
 * voice, instructions, server-side VAD, input transcription, and the document
 * tools) is set here so the browser only has to wire audio + handle events.
 */

const VOICE = "marin"; // warm, natural GA voice

const ORBY_INSTRUCTIONS =
  "You are Orby, on a live voice call with the user. This is a spoken, natural back-and-forth — keep replies short, warm, and conversational, the way a thoughtful friend talks. Usually one or two sentences. Never use markdown, lists, headings, emoji, or URLs. " +
  "You can act on the user's documents using your tools. Use them whenever the user asks to open, read, find, add to, edit, rename a document, mark sentences for deletion, or jump to a sentence. " +
  "When you need a document by description or title, call the matching tool with what the user said — the app fuzzy-matches it, so you don't need an exact title. " +
  "After you read a document with the read_document tool, you receive its numbered sentences; use them to answer follow-up questions and to choose sentence indexes for jump or edit actions. " +
  "When a tool succeeds, confirm briefly and naturally out loud (for example 'Opening it now' or 'Added that'). If a tool can't find the document, ask the user to clarify the title. " +
  "If the user says goodbye, wants to hang up, or is clearly done, call the end_call tool after a brief farewell. " +
  "Keep the energy alive and responsive — react quickly, don't over-explain, and let the user interrupt you at any time.";

const tools = [
  {
    type: "function",
    name: "open_document",
    description:
      "Open one of the user's documents on screen and start reading it aloud. Use when the user asks to open/pull up/go to a document.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What the user said the document is called or about.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "find_document",
    description:
      "Find the title of a document the user is trying to remember, WITHOUT opening it. Returns the closest matching title.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the user described." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "read_document",
    description:
      "Load a document's full contents so you can read it and answer questions about it. Returns its numbered sentences. Set use_active true to read the document already open on screen.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the user said the document is, if not the active one." },
        use_active: { type: "boolean", description: "True to use the document currently open on screen." },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "add_text",
    description: "Append text to a document. Use the active document unless the user named another.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The exact text to add." },
        query: { type: "string", description: "Target document if not the active one." },
        use_active: { type: "boolean" },
      },
      required: ["text"],
    },
  },
  {
    type: "function",
    name: "mark_for_deletion",
    description:
      "Mark sentences in a document for deletion based on what the user described. Defaults to the active or currently displayed document.",
    parameters: {
      type: "object",
      properties: {
        utterance: { type: "string", description: "The user's description of which sentences to mark." },
        query: { type: "string", description: "Target document if not the active one." },
        use_active: { type: "boolean" },
      },
      required: ["utterance"],
    },
  },
  {
    type: "function",
    name: "edit_sentence",
    description: "Replace the text of one sentence in the active document.",
    parameters: {
      type: "object",
      properties: {
        sentence_index: { type: "number", description: "0-based index of the sentence to change. Omit to use the current sentence." },
        new_text: { type: "string", description: "The new sentence text." },
      },
      required: ["new_text"],
    },
  },
  {
    type: "function",
    name: "jump_to_sentence",
    description: "Move the reading cursor in the active document to a specific sentence.",
    parameters: {
      type: "object",
      properties: {
        sentence_index: { type: "number", description: "0-based sentence index to jump to." },
      },
      required: ["sentence_index"],
    },
  },
  {
    type: "function",
    name: "rename_document",
    description: "Rename a document's title.",
    parameters: {
      type: "object",
      properties: {
        new_title: { type: "string" },
        query: { type: "string", description: "Target document if not the active one." },
        use_active: { type: "boolean" },
      },
      required: ["new_title"],
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "End the live call. Call this after a brief farewell when the user is done.",
    parameters: { type: "object", properties: {} },
  },
];

export const createRealtimeCallSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const body = {
      session: {
        type: "realtime",
        model: "gpt-realtime",
        instructions: ORBY_INSTRUCTIONS,
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
            },
          },
          output: { voice: VOICE },
        },
        tools,
        tool_choice: "auto",
      },
    };

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": context.userId ?? "anon",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[createRealtimeCallSession] OpenAI error", res.status, errText);
      throw new Error(`Failed to start voice session (${res.status})`);
    }

    const data = (await res.json()) as { value?: string; expires_at?: number };
    const token = data.value;
    if (!token) throw new Error("No ephemeral token returned");

    return { token, expiresAt: data.expires_at ?? null, model: "gpt-realtime" };
  });
