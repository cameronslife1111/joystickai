import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";

export type MediaFolder = {
  id: string;
  user_id: string;
  name: string;
  sort_index: number;
  created_at: string;
  updated_at: string;
};

export type MediaFolderItem = {
  id: string;
  user_id: string;
  folder_id: string;
  asset_id: string;
  created_at: string;
};

/** Virtual folder ids. */
export const ALL_MEDIA = "all";
export const UNSORTED = "unsorted";

export const FOLDERS_KEY = ["media_folders"] as const;
export const FOLDER_ITEMS_KEY = ["media_folder_items"] as const;

export function useMediaFolders() {
  return useQuery({
    queryKey: FOLDERS_KEY,
    queryFn: async (): Promise<MediaFolder[]> => {
      const { data, error } = await supabase
        .from("media_folders")
        .select("*")
        .order("sort_index", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MediaFolder[];
    },
  });
}

export function useMediaFolderItems() {
  return useQuery({
    queryKey: FOLDER_ITEMS_KEY,
    queryFn: async (): Promise<MediaFolderItem[]> => {
      const { data, error } = await supabase.from("media_folder_items").select("*");
      if (error) throw error;
      return (data ?? []) as MediaFolderItem[];
    },
  });
}

/** folder_id -> Set(asset_id) and asset_id -> folder_id[] */
export function indexFolderItems(items: MediaFolderItem[]) {
  const byFolder = new Map<string, Set<string>>();
  const byAsset = new Map<string, string[]>();
  for (const it of items) {
    if (!byFolder.has(it.folder_id)) byFolder.set(it.folder_id, new Set());
    byFolder.get(it.folder_id)!.add(it.asset_id);
    byAsset.set(it.asset_id, [...(byAsset.get(it.asset_id) ?? []), it.folder_id]);
  }
  return { byFolder, byAsset };
}

export function useMediaFolderMutations(userId: string | null) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: FOLDERS_KEY });
    qc.invalidateQueries({ queryKey: FOLDER_ITEMS_KEY });
  };

  const createFolder = useMutation({
    mutationFn: async (name: string): Promise<MediaFolder> => {
      if (!userId) throw new Error("Not signed in");
      const existing = qc.getQueryData<MediaFolder[]>(FOLDERS_KEY) ?? [];
      const sort_index = existing.reduce((m, f) => Math.max(m, f.sort_index), -1) + 1;
      const { data, error } = await supabase
        .from("media_folders")
        .insert({ user_id: userId, name: name.trim() || "New folder", sort_index })
        .select()
        .single();
      if (error) throw error;
      return data as MediaFolder;
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Could not create folder"),
  });

  const renameFolder = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from("media_folders")
        .update({ name: name.trim() || "Untitled folder" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Could not rename folder"),
  });

  const deleteFolder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("media_folders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Could not delete folder"),
  });

  const reorderFolders = useMutation({
    mutationFn: async (ordered: MediaFolder[]) => {
      await Promise.all(
        ordered.map((f, i) =>
          supabase.from("media_folders").update({ sort_index: i }).eq("id", f.id),
        ),
      );
    },
    onSuccess: () => refresh(),
  });

  /** Add assets to a folder (keeps existing memberships). */
  const addToFolder = useMutation({
    mutationFn: async ({ folderId, assetIds }: { folderId: string; assetIds: string[] }) => {
      if (!userId) throw new Error("Not signed in");
      if (assetIds.length === 0) return;
      const rows = assetIds.map((asset_id) => ({ user_id: userId, folder_id: folderId, asset_id }));
      const { error } = await supabase
        .from("media_folder_items")
        .upsert(rows, { onConflict: "folder_id,asset_id", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Could not add to folder"),
  });

  const removeFromFolder = useMutation({
    mutationFn: async ({ folderId, assetIds }: { folderId: string; assetIds: string[] }) => {
      if (assetIds.length === 0) return;
      const { error } = await supabase
        .from("media_folder_items")
        .delete()
        .eq("folder_id", folderId)
        .in("asset_id", assetIds);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Could not remove from folder"),
  });

  /** Move: remove from source folder (if a real folder), then add to target. */
  const moveToFolder = useMutation({
    mutationFn: async ({
      fromFolderId,
      toFolderId,
      assetIds,
    }: { fromFolderId: string | null; toFolderId: string; assetIds: string[] }) => {
      if (!userId) throw new Error("Not signed in");
      if (assetIds.length === 0) return;
      if (fromFolderId && fromFolderId !== ALL_MEDIA && fromFolderId !== UNSORTED) {
        await supabase
          .from("media_folder_items")
          .delete()
          .eq("folder_id", fromFolderId)
          .in("asset_id", assetIds);
      }
      const rows = assetIds.map((asset_id) => ({ user_id: userId, folder_id: toFolderId, asset_id }));
      const { error } = await supabase
        .from("media_folder_items")
        .upsert(rows, { onConflict: "folder_id,asset_id", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast.error(e?.message ?? "Could not move media"),
  });

  return {
    createFolder,
    renameFolder,
    deleteFolder,
    reorderFolders,
    addToFolder,
    removeFromFolder,
    moveToFolder,
    refresh,
  };
}

/** Fire-and-forget filing used after uploads / generations. */
export async function fileAssetIntoFolder(
  userId: string,
  folderId: string,
  assetId: string,
) {
  if (!folderId || folderId === ALL_MEDIA || folderId === UNSORTED) return;
  await supabase
    .from("media_folder_items")
    .upsert(
      [{ user_id: userId, folder_id: folderId, asset_id: assetId }],
      { onConflict: "folder_id,asset_id", ignoreDuplicates: true },
    );
}
