import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";
import {
  DELEGATE_ANALYZE_SYSTEM,
  buildDelegateAnalyzeUserPrompt,
} from "./delegate-prompt";

const inputSchema = z.object({
  documentId: z.string().uuid(),
  index: z.number().int().min(0),
});

const outSchema = z.object({
  is_substep: z.boolean().default(false),
  parent_task: z.string().default(""),
  task_context: z.string().default(""),
});

function stripFence(raw: string): string {
  const t = (raw ?? "").trim();
  if (t.startsWith("```")) return t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  return t;
}

/**
 * 🟣 Delegate: analyse the line the user is standing on — is it a substep of a
 * bigger task or a standalone task, and what is the task to carry out.
 */
export const analyzeDelegateStep = createServerFn({ method: "POST" })
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
      isSubstep: boolean;
      parentTask: string;
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
        model: provider("gpt-5.6-sol"),
        system: DELEGATE_ANALYZE_SYSTEM,
        messages: [
          {
            role: "user",
            content: buildDelegateAnalyzeUserPrompt({ title: doc.title, sentences, index }),
          },
        ],
      });

      let parsed: z.infer<typeof outSchema>;
      try {
        parsed = outSchema.parse(JSON.parse(stripFence(text ?? "")));
      } catch {
        parsed = { is_substep: false, parent_task: "", task_context: "" };
      }

      return {
        title: doc.title,
        sentences,
        index,
        taskContext: parsed.task_context ?? "",
        isSubstep: !!parsed.is_substep,
        parentTask: parsed.parent_task ?? "",
      };
    },
  );
