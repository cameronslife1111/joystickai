import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";
import {
  DELEGATE_SUGGEST_SYSTEM,
  buildDelegateSuggestUserPrompt,
  type DelegateSuggestion,
} from "./delegate-prompt";

const inputSchema = z.object({
  documentId: z.string().uuid(),
  index: z.number().int().min(0),
});

const outSchema = z.object({
  task_context: z.string().default(""),
  suggestions: z
    .array(
      z.object({
        title: z.string().min(1),
        detail: z.string().default(""),
        capabilities: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});


function stripFence(raw: string): string {
  const t = (raw ?? "").trim();
  if (t.startsWith("```")) return t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  return t;
}

/**
 * 🟣 Delegate (menu slot 15): propose 5 concrete tasks Orby could do for the
 * part of the document the user is standing on.
 */
export const suggestDelegateTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      title: string;
      sentences: string[];
      index: number;
      taskContext: string;
      suggestions: DelegateSuggestion[];
    }> => {
      const apiKey = process.env.OPENAI_API_KEY;
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
        model: provider("gpt-5.6-terra"),
        system: DELEGATE_SUGGEST_SYSTEM,
        messages: [
          {
            role: "user",
            content: buildDelegateSuggestUserPrompt({ title: doc.title, sentences, index }),
          },
        ],
      });

      let parsed: z.infer<typeof outSchema>;
      try {
        parsed = outSchema.parse(JSON.parse(stripFence(text ?? "")));
      } catch {
        throw new Error("Couldn't read Orby's suggestions — try again");
      }

      const capSet = new Set<string>(DELEGATE_CAP_KEYS);
      return {
        title: doc.title,
        sentences,
        index,
        taskContext: parsed.task_context ?? "",
        suggestions: parsed.suggestions.slice(0, 5).map((s) => ({
          title: s.title,
          detail: s.detail,
          capabilities: s.capabilities.filter((c): c is DelegateCapKey => capSet.has(c)),
        })),
      };

    },
  );
