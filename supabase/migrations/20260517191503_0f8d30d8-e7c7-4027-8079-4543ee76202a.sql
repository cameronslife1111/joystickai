CREATE TABLE public.media_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  kind TEXT NOT NULL CHECK (kind IN ('image','video','audio')),
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  duration_seconds NUMERIC,
  width INTEGER,
  height INTEGER,
  source_document_id UUID NULL REFERENCES public.documents(id) ON DELETE SET NULL,
  seen_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_assets_user_created
  ON public.media_assets (user_id, created_at DESC);

CREATE INDEX idx_media_assets_user_kind
  ON public.media_assets (user_id, kind, created_at DESC);

CREATE INDEX idx_media_assets_user_unseen
  ON public.media_assets (user_id) WHERE seen_at IS NULL;

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own media_assets select" ON public.media_assets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own media_assets insert" ON public.media_assets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own media_assets update" ON public.media_assets
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own media_assets delete" ON public.media_assets
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER media_assets_touch
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO storage.buckets (id, name, public)
VALUES ('joystick-media', 'joystick-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read joystick-media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'joystick-media');

CREATE POLICY "users upload joystick-media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'joystick-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "users update own joystick-media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'joystick-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "users delete own joystick-media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'joystick-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );