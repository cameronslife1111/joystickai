UPDATE public.plan_schedules
SET next_run_at = now() + (interval_n || ' hours')::interval,
    claim_at = NULL
WHERE id = '55b27f48-0d81-417d-b895-bc041ba2333e'
  AND next_run_at < now();