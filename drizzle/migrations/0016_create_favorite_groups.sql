CREATE TABLE public.favorite_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorite_groups TO authenticated;
GRANT ALL ON public.favorite_groups TO service_role;
ALTER TABLE public.favorite_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own groups" ON public.favorite_groups FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);