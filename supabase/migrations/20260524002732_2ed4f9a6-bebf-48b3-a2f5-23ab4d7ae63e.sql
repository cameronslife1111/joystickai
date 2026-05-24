ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS tick_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_no_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS watchdog_at timestamptz;

UPDATE public.plans
SET watchdog_at = now() + interval '2 hours'
WHERE watchdog_at IS NULL
  AND status IN ('approved', 'running', 'awaiting_media');

CREATE INDEX IF NOT EXISTS plans_active_status_idx
  ON public.plans (status)
  WHERE status IN ('approved', 'running', 'awaiting_media');