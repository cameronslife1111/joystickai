-- Orchestrator chat: one pinned chat per user that works through the other chats.
ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS is_orchestrator boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_orchestrator_per_user
  ON public.chat_threads (user_id)
  WHERE is_orchestrator;

-- Who wrote a chat message: 'user' | 'assistant' | 'orchestrator'.
-- Nullable so existing rows keep working (null = derived from role).
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS author text;

CREATE TABLE IF NOT EXISTS public.orchestrator_state (
  user_id uuid PRIMARY KEY,
  thread_id uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  focus_document_ids uuid[] NOT NULL DEFAULT '{}',
  autopilot_enabled boolean NOT NULL DEFAULT true,
  last_tick_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orchestrator_state TO authenticated;
GRANT ALL ON public.orchestrator_state TO service_role;

ALTER TABLE public.orchestrator_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orchestrator_state own rows"
  ON public.orchestrator_state
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER orchestrator_state_touch
  BEFORE UPDATE ON public.orchestrator_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.plan_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  title text,
  plan_summary text,
  user_request text NOT NULL,
  proposed_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  attached_document_ids uuid[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'autopilot',
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_proposals TO authenticated;
GRANT ALL ON public.plan_proposals TO service_role;

ALTER TABLE public.plan_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_proposals own rows"
  ON public.plan_proposals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER plan_proposals_touch
  BEFORE UPDATE ON public.plan_proposals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS plan_proposals_user_status_idx
  ON public.plan_proposals (user_id, status, created_at DESC);