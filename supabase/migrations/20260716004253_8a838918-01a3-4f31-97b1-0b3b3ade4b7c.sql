CREATE TABLE public.document_icons (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  media_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_icons_user_id_idx ON public.document_icons (user_id);
CREATE INDEX document_icons_media_asset_id_idx ON public.document_icons (media_asset_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_icons TO authenticated;
GRANT ALL ON public.document_icons TO service_role;

ALTER TABLE public.document_icons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own document icons"
  ON public.document_icons FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own document icons"
  ON public.document_icons FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own document icons"
  ON public.document_icons FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own document icons"
  ON public.document_icons FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);