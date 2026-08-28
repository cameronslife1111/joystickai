import { createServerFn } from "@tanstack/react-start";
import { generateText as aiSdkGenerateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "./ai-gateway";

const schema = z.object({
  originalPrompt: z.string().max(20000).default(""),
  change: z.string().min(1).max(4000),
  kind: z.enum(["image", "video"]).default("image"),
  /** "edit" = instruction applied to an attached image, "video" = full prompt rewrite. */
  mode: z.enum(["edit", "rewrite"]).default("rewrite"),
});

/**
 * Rewrites an image/video generation prompt so it keeps the original subject
 * and style while applying the change the user spoke out loud.
 */
export const rewriteMediaPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const provider = createOpenAiProvider(apiKey);
    const model = provider("gpt-5.6-sol");

    const system =
      data.mode === "edit"
        ? "You write image EDIT instructions for an image-editing model. " +
          "The first attached image is the exact image being edited; any other attached images are references (character/face/style) that must be respected. " +
          "You are given the original generation prompt (context only) and a change the user requested out loud. " +
          "Return ONE single instruction that states precisely what to change and what must stay identical. " +
          "Preserve the subject's identity, face, hair, body, wardrobe, pose, framing, lighting and style unless the user asked to change them. " +
          "Do not re-describe the whole scene from scratch and do not invent new details the user did not ask for. " +
          "Plain text only. No markdown, no quotes, no commentary, no labels — output only the instruction itself."
        : `You rewrite ${data.kind} generation prompts. ` +
          "You are given the original prompt and a change the user requested out loud. " +
          "Return ONE single rewritten prompt that keeps everything from the original except what the user asked to change. " +
          "Plain text only. No markdown, no quotes, no commentary, no labels — output only the prompt itself.";

    const user =
      `Original prompt:\n${data.originalPrompt.trim() || "(none provided)"}\n\n` +
      `Requested change:\n${data.change.trim()}`;

    const { text } = await aiSdkGenerateText({ model, system, prompt: user });
    const cleaned = (text ?? "").replace(/^["'`\s]+|["'`\s]+$/g, "").trim();
    if (!cleaned) throw new Error("Could not rewrite the prompt");
    return { prompt: cleaned };
  });
