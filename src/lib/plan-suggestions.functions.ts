import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const schema = z.object({
  documentId: z.string().uuid(),
});

export type PlanSuggestion = { label: string; request: string };

const systemPrompt = `You are Orby's suggestion engine. You read ONE of the user's documents and propose the TOP 4 highest-leverage things Orby could do to help the user, based on what that document says they actually need to do.

WHAT ORBY CAN DO (you may ONLY suggest things achievable with these capabilities):
- Create or rename documents
- Add, edit, move, or mark sentences for deletion; link a sentence to another document
- Web search and write results into a document
- Generate text and write it into a document
- Generate images, regenerate/remix images
- Generate video from images/audio
Orby CANNOT permanently delete data and cannot do anything outside these capabilities.

HOW TO READ THE DOCUMENT:
- Tasks/to-dos are usually near the TOP of the document. Weight earlier items higher.
- Detect where each new task or step begins: numbered lists (1. 2. 3.), bullets (- *), checklist markers ([ ], [x]), or distinct paragraph steps.
- If it is a checklist / task list: each suggestion should target a real task the user wrote.
- If it is a context / reference doc (no explicit tasks): suggest genuinely useful actions derived from its content (e.g. summarize it into a new doc, research an open question it raises, generate an image it describes).
- Pick the 4 MOST high-leverage, scalable actions. Skip trivial ones.

OUTPUT:
Return ONLY a JSON object of this exact shape (no markdown, no code fences):
{
  "suggestions": [
    { "label": "Short button text (~6 words)", "request": "A clear, complete instruction phrased as if the user typed it to Orby, referencing the document by its title so Orby can resolve it." }
  ]
}
Return at most 4 suggestions. Each "request" must be self-contained and executable with the capabilities above. If the document has nothing actionable, return {"suggestions": []}.`;

export const suggestDocumentPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<{ suggestions: PlanSuggestion[] }> => {
    const { supabase } = context;

    const { data: doc } = await supabase
      .from("documents")
      .select("title")
      .eq("id", data.documentId)
      .single();
    if (!doc) return { suggestions: [] };

    const { data: rows } = await supabase
      .from("sentences")
      .select("content, order_index")
      .eq("document_id", data.documentId)
      .order("order_index", { ascending: true })
      .limit(400);

    const title = doc.title ?? "Untitled";
    const lines = (rows ?? [])
      .map((r: { content: string }, i: number) => `${i + 1}. ${r.content}`)
      .join("\n")
      .slice(0, 12000);

    if (!lines.trim()) return { suggestions: [] };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.5");

    const userPrompt = `Document title: ${JSON.stringify(title)}\n\nDocument contents (in order):\n${lines}`;

    const { text } = await aiSdkGenerateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    let parsed: any;
    try {
      const raw = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(raw);
    } catch {
      return { suggestions: [] };
    }

    const list: PlanSuggestion[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const cleaned = list
      .map((s) => ({
        label: String(s?.label ?? "").trim().slice(0, 80),
        request: String(s?.request ?? "").trim().slice(0, 2000),
      }))
      .filter((s) => s.label && s.request)
      .slice(0, 4);

    return { suggestions: cleaned };
  });
