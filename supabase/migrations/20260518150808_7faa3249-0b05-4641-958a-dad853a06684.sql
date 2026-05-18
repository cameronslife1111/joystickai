CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('composing','proposed','approved','running','completed','failed','cancelled')),
  user_request TEXT NOT NULL,
  plan_summary TEXT NULL,
  steps JSONB NULL,
  current_step INT NOT NULL DEFAULT 0,
  total_steps INT NOT NULL DEFAULT 0,
  origin_document_id UUID NULL REFERENCES public.documents(id) ON DELETE SET NULL,
  origin_sentence_index INT NULL,
  result_summary TEXT NULL,
  error_message TEXT NULL,
  error_lovable_prompt TEXT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_plans_user_status ON public.plans (user_id, status, created_at DESC);
CREATE INDEX idx_plans_user_runnable ON public.plans (user_id) WHERE status IN ('approved','running');
CREATE INDEX idx_plans_user_unacked ON public.plans (user_id) WHERE acknowledged = false AND status IN ('completed','failed');

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own plans select" ON public.plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own plans insert" ON public.plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own plans update" ON public.plans FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.plans;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.plans REPLICA IDENTITY FULL;