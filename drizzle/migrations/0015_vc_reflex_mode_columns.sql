ALTER TABLE public.vc_runs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'reflex',
  ADD COLUMN IF NOT EXISTS cdp_url text,
  ADD COLUMN IF NOT EXISTS page_ws text,
  ADD COLUMN IF NOT EXISTS action_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sub_goals jsonb,
  ADD COLUMN IF NOT EXISTS type_values jsonb,
  ADD COLUMN IF NOT EXISTS no_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;