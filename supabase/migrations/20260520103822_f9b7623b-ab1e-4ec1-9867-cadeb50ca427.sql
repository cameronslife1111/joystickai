ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS attached_document_ids uuid[] NOT NULL DEFAULT '{}';