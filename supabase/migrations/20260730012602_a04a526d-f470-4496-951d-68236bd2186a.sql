ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS compose_claim_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS compose_attempts integer NOT NULL DEFAULT 0;