ALTER TABLE public.user_preferences
  ADD COLUMN background_media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL;