import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AppBackground {
  id: string;
  url: string;
}

/**
 * The user's chosen app-wide background photo (a media asset), or null.
 * Shared by the page background layer and the media gallery action sheet.
 */
export function useAppBackground(): AppBackground | null {
  const { data } = useQuery({
    queryKey: ["app_background"],
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AppBackground | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("background_media_asset_id")
        .eq("user_id", u.user.id)
        .maybeSingle();
      const id = prefs?.background_media_asset_id ?? null;
      if (!id) return null;
      const { data: asset } = await supabase
        .from("media_assets")
        .select("id, url")
        .eq("id", id)
        .maybeSingle();
      if (!asset?.url) return null;
      return { id: asset.id as string, url: asset.url as string };
    },
  });
  return data ?? null;
}

/** Set (or clear, with null) the app-wide background photo. */
export async function setAppBackground(assetId: string | null): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { user_id: u.user.id, background_media_asset_id: assetId },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}
