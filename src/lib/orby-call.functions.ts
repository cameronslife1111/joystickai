import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const chatMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50000),
});

const chatSchema = z.object({
  messages: z.array(chatMsg).min(1).max(60),
});

export const chatWithOrby = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chatSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You are Orby on a live voice call with the user. " +
      "This is a spoken back-and-forth, not a chat window — your reply will be read aloud by a TTS voice. " +
      "Keep replies SHORT: usually 1 sentence, occasionally 2. Conversational, warm, easy to listen to. " +
      "No markdown, no lists, no headings, no emoji, no URLs, no bullet points. " +
      "Ask one focused follow-up question when it helps the user think. " +
      "You cannot generate plans on this call. If the user asks for a plan, briefly tell them plans are made from the plan composer, not on the call. " +
      "If the user says goodbye or hang up, say a brief farewell and the app will end the call. " +
      "The user may attach document contents to this conversation as assistant messages of the form '[document: \"<title>\"]' followed by numbered sentences. Treat those as authoritative context for follow-up questions and reference the document by title when helpful. " +
      "If the user asks you to read, open, pull up, add text to, or mark sentences for deletion in a document, simply acknowledge briefly (e.g. 'Reading it now.' or 'Adding to it.') — the app performs the action automatically. " +
      "If the user is trying to remember a document's name or asks what a document is called, reply briefly with the closest matching title using the phrasing \"The title you may be referring to is '<title>'.\" and do not take any other action unless asked.";

    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: data.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return { text: (text ?? "").trim() };
  });

const distillSchema = z.object({
  transcript: z.string().min(1).max(20000),
});

export const distillCallTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => distillSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const system =
      "You convert a voice call transcript between a user and Orby (an AI assistant) into a clean, actionable request brief that a downstream planner will turn into tool steps. " +
      "Read the whole transcript and extract EVERY concrete thing the user asked for, decided on, or said they want done. " +
      "Ignore Orby's filler, acknowledgements, hedges, and clarifying questions — those are not intents. " +
      "Ignore small talk and abandoned/retracted ideas. " +
      "Preserve specific document titles, media titles, names, numbers, and exact phrasings the user used (do not paraphrase proper nouns or quoted text) so the planner can match them. " +
      "Combine duplicated requests into one item. Order items the way the user said them. " +
      "Output PLAIN TEXT ONLY in this exact shape:\n\n" +
      "Summary: <one short sentence describing the overall goal>\n" +
      "Tasks:\n" +
      "1. <imperative task>\n" +
      "2. <imperative task>\n" +
      "...\n\n" +
      "No markdown, no headings beyond the two labels above, no JSON, no commentary, no preamble. Keep the whole brief under 1500 characters. " +
      "If the user expressed no concrete actionable intent, output exactly: Summary: No actionable request was made on the call.\nTasks:\n(none)";

    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: [{ role: "user", content: data.transcript }],
    });

    return { request: (text ?? "").trim() };
  });

const webSearchCallSchema = z.object({
  query: z.string().min(1).max(2000),
});

/**
 * Live-call web search. Runs a Perplexity query and returns concise,
 * speech-friendly prose that Orby reads aloud on the call. No document writing.
 */
export const webSearchForCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => webSearchCallSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "Web search isn't configured." };
    }

    try {
      const res = await fetch("https://api.perplexity.ai/v1/agent", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preset: "pro-search",
          input: data.query.trim(),
          tools: [{ type: "web_search" }],
          instructions:
            "You are Orby, on a live voice call. The user asked you to look something up on the web. " +
            "Use web_search to find current, accurate information, then answer as if speaking out loud. " +
            "Keep it SHORT and conversational — usually 2 to 4 sentences. " +
            "Plain text only: no markdown, no lists, no headings, no citation markers like [1], and do not read out raw URLs. " +
            "Lead with the answer; only add a detail or two if it's genuinely useful.",
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn("[webSearchForCall] perplexity error", res.status, errText.slice(0, 300));
        return { ok: false as const, error: "The web search failed." };
      }

      const result: any = await res.json();
      let text = "";
      if (Array.isArray(result?.output)) {
        for (const item of result.output) {
          if (item?.type === "message" && Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c?.type === "output_text" && typeof c.text === "string") {
                text += c.text;
              }
            }
          }
        }
      }
      text = text
        .replace(/\[\d+(?:,\s*\d+)*\]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!text) return { ok: false as const, error: "I couldn't find anything on that." };
      return { ok: true as const, text };
    } catch (e) {
      console.warn("[webSearchForCall] failed", e);
      return { ok: false as const, error: "The web search failed." };
    }
  });


