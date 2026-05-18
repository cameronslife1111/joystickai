ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS fal_request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS fal_status_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS fal_response_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS fal_model_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_user_polling
  ON public.media_assets (user_id, status)
  WHERE status = 'generating' AND fal_status_url IS NOT NULL;