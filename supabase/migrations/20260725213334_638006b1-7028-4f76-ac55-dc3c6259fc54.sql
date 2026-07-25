CREATE TABLE public.media_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_folders TO authenticated;
GRANT ALL ON public.media_folders TO service_role;

ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own media folders"
ON public.media_folders FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX media_folders_user_sort_idx ON public.media_folders (user_id, sort_index, created_at);

CREATE TRIGGER media_folders_touch_updated_at
BEFORE UPDATE ON public.media_folders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.media_folder_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  folder_id UUID NOT NULL REFERENCES public.media_folders(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (folder_id, asset_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_folder_items TO authenticated;
GRANT ALL ON public.media_folder_items TO service_role;

ALTER TABLE public.media_folder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own media folder items"
ON public.media_folder_items FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX media_folder_items_folder_idx ON public.media_folder_items (folder_id);
CREATE INDEX media_folder_items_asset_idx ON public.media_folder_items (asset_id);
CREATE INDEX media_folder_items_user_idx ON public.media_folder_items (user_id);