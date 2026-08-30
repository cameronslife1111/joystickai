import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Documents that get attached automatically to every newly created chat.
 * Stored on user_preferences.auto_attach_document_ids.
 */
export async function fetchAutoAttachDocIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("auto_attach_document_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return [];
  return ((data as any)?.auto_attach_document_ids ?? []) as string[];
}

export function useAutoAttachDocs(userId: string | null) {
  const qc = useQueryClient();
  const { data: ids = [] } = useQuery({
    queryKey: ["auto_attach_docs", userId],
    enabled: !!userId,
    queryFn: () => fetchAutoAttachDocIds(userId as string),
  });

  const save = async (next: string[]) => {
    if (!userId) return;
    qc.setQueryData(["auto_attach_docs", userId], next);
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        { user_id: userId, auto_attach_document_ids: next } as any,
        { onConflict: "user_id" },
      );
    if (error) {
      qc.invalidateQueries({ queryKey: ["auto_attach_docs", userId] });
      throw error;
    }
  };

  return { ids, save };
}
