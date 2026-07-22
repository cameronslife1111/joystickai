
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_status_check;
ALTER TABLE public.plans ADD CONSTRAINT plans_status_check
  CHECK (status = ANY (ARRAY[
    'composing'::text, 'proposed'::text, 'approved'::text, 'running'::text,
    'awaiting_media'::text, 'awaiting_user'::text,
    'completed'::text, 'failed'::text, 'cancelled'::text, 'retrying'::text
  ]));
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS awaiting_since timestamptz;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS awaiting_count int NOT NULL DEFAULT 0;
