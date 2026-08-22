import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string; voice?: string }) => {
    const text = String(input?.text ?? "").slice(0, 1200).trim();
    if (!text) throw new Error("text is required");
    return { text, voice: input?.voice ?? "alloy" };
  })
  .handler(async ({ data }) => {
    const { synthesizeMp3 } = await import("./tts.server");
    return { audio: await synthesizeMp3(data.text, data.voice) };
  });
