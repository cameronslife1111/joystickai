ALTER TABLE public.media_assets ALTER COLUMN url DROP NOT NULL;
ALTER TABLE public.media_assets ALTER COLUMN storage_path DROP NOT NULL;

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS status TEXT NULL
    CHECK (status IS NULL OR status IN ('generating', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS generation_params JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_user_status
  ON public.media_assets (user_id, status)
  WHERE status IS NOT NULL;

ALTER TABLE public.media_assets REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.media_assets;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;