-- plan_schedules: recurring/one-shot templates that fire new `plans` rows.
CREATE TABLE public.plan_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled schedule',
  user_request text NOT NULL,
  attached_document_ids uuid[] NOT NULL DEFAULT '{}',

  cadence text NOT NULL CHECK (cadence IN ('once','hourly','daily','weekly','monthly','yearly')),
  interval_n integer NOT NULL DEFAULT 1 CHECK (interval_n >= 1 AND interval_n <= 365),
  time_of_day text,            -- "HH:MM" in `timezone`
  timezone text NOT NULL DEFAULT 'UTC',
  weekdays integer[] NOT NULL DEFAULT '{}',   -- 0=Sun .. 6=Sat
  month_days integer[] NOT NULL DEFAULT '{}', -- 1..31
  year_month_days jsonb NOT NULL DEFAULT '[]'::jsonb,

  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,

  next_run_at timestamptz,
  claim_at timestamptz,        -- non-null = currently being fired; auto-stale after 5min
  last_run_at timestamptz,
  last_plan_id uuid,
  run_count integer NOT NULL DEFAULT 0,
  max_runs integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plan_schedules_due_idx
  ON public.plan_schedules (next_run_at)
  WHERE enabled = true;

CREATE INDEX plan_schedules_user_idx
  ON public.plan_schedules (user_id, created_at DESC);

ALTER TABLE public.plan_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own plan_schedules select" ON public.plan_schedules
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own plan_schedules insert" ON public.plan_schedules
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own plan_schedules update" ON public.plan_schedules
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own plan_schedules delete" ON public.plan_schedules
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER plan_schedules_touch_updated_at
  BEFORE UPDATE ON public.plan_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Plans gain provenance.
ALTER TABLE public.plans
  ADD COLUMN schedule_id uuid,
  ADD COLUMN scheduled_for timestamptz;

CREATE INDEX plans_schedule_id_idx ON public.plans (schedule_id) WHERE schedule_id IS NOT NULL;
CREATE INDEX plans_user_scheduled_for_idx ON public.plans (user_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

-- Atomic claim: returns the schedule if it's due, enabled, and not already
-- claimed in the last 5 minutes. Caller is then responsible for setting
-- next_run_at + clearing claim_at.
CREATE OR REPLACE FUNCTION public.claim_due_schedule(p_id uuid)
RETURNS public.plan_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.plan_schedules;
BEGIN
  UPDATE public.plan_schedules
  SET claim_at = now()
  WHERE id = p_id
    AND enabled = true
    AND next_run_at IS NOT NULL
    AND next_run_at <= now()
    AND (claim_at IS NULL OR claim_at < now() - interval '5 minutes')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Service role / internal scheduler tick uses this; explicit grant keeps it
-- callable from the supabaseAdmin client.
GRANT EXECUTE ON FUNCTION public.claim_due_schedule(uuid) TO authenticated, service_role;