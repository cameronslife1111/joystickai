ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_status_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_status_check
  CHECK (status IN ('composing','proposed','approved','running','awaiting_media','completed','failed','cancelled'));

DROP INDEX IF EXISTS idx_plans_user_runnable;
CREATE INDEX idx_plans_user_runnable
  ON public.plans (user_id)
  WHERE status IN ('approved','running','awaiting_media');