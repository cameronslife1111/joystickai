import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";
import { BABY_STEPS_SYSTEM, buildBabyStepsUserPrompt } from "./baby-steps-prompt";

const inputSchema = z.object({
  documentId: z.string().uuid(),
  index: z.number().int().min(0),
});

const outSchema = z.object({
  notes: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
});

function stripFence(raw: string): string {
  const t = (raw ?? "").trim();
  if (t.startsWith("```")) return t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  return t;
}

/** One line, no markdown, always terminated with a period. */
function tidy(line: string): string {
  const s = (line ?? "")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!s) return "";
  return `${s}.`;
}

/**
 * 👣 Baby steps: break the line the user is standing on into exactly four
 * "Go to the X and Y." steps, plus any notes that belong before them.
 */
export const generateBabySteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ notes: string[]; steps: string[]; index: number; original: string }> => {
      const apiKey = process.env["OPENAI_API_KEY"];
      if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

      const { data: doc, error: docErr } = await context.supabase
        .from("documents")
        .select("id, title")
        .eq("id", data.documentId)
        .single();
      if (docErr || !doc) throw new Error("Document not found");

      const { data: rows, error: sErr } = await context.supabase
        .from("sentences")
        .select("content, order_index")
        .eq("document_id", data.documentId)
        .order("order_index", { ascending: true });
      if (sErr) throw new Error(sErr.message);

      const sentences = (rows ?? []).map((r) => r.content as string);
      if (sentences.length === 0) throw new Error("That document has no sentences yet");
      const index = Math.min(data.index, sentences.length - 1);

      const provider = createOpenAiProvider(apiKey);
      const { text } = await generateText({
        model: provider("gpt-5.6-sol"),
        system: BABY_STEPS_SYSTEM,
        messages: [
          {
            role: "user",
            content: buildBabyStepsUserPrompt({ title: doc.title, sentences, index }),
          },
        ],
      });

      let parsed: z.infer<typeof outSchema>;
      try {
        parsed = outSchema.parse(JSON.parse(stripFence(text ?? "")));
      } catch {
        throw new Error("Could not read the baby steps");
      }

      const notes = parsed.notes
        .map((n) => tidy(n))
        .filter(Boolean)
        .map((n) => (/^note\s*:/i.test(n) ? n : `Note: ${n}`))
        .slice(0, 3);
      const steps = parsed.steps.map((s) => tidy(s)).filter(Boolean);
      if (steps.length !== 4) throw new Error("The AI did not return exactly four baby steps");

      return { notes, steps, index, original: sentences[index] ?? "" };
    },
  );
