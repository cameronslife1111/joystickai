import { supabase } from "@/integrations/supabase/client";

/**
 * Builds the final prompt string sent to the image model.
 * Order: user's typed text first, then each attached document's full content,
 * separated by double newlines.
 */
export async function assembleImagePrompt(
  userText: string,
  documentIds: string[],
): Promise<string> {
  const parts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) parts.push(trimmed);

  for (const docId of documentIds) {
    const { data: sentences } = await supabase
      .from("sentences")
      .select("content")
      .eq("document_id", docId)
      .order("order_index", { ascending: true });
    const joined = (sentences ?? [])
      .map((s) => s.content)
      .join(" ")
      .trim();
    if (joined) parts.push(joined);
  }

  return parts.join("\n\n");
}
