ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS review_in_chat BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposed_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;