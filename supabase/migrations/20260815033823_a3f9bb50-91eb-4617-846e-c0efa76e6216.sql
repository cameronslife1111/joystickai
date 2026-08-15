ALTER TABLE public.plan_schedules
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS plan_schedules_thread_id_idx ON public.plan_schedules(thread_id);