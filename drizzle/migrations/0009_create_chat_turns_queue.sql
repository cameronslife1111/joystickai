CREATE TABLE public.chat_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  claim_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_turns_pending_idx ON public.chat_turns (status, created_at);
CREATE INDEX chat_turns_thread_idx ON public.chat_turns (thread_id, status);
CREATE INDEX chat_turns_user_idx ON public.chat_turns (user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_turns TO authenticated;
GRANT ALL ON public.chat_turns TO service_role;

ALTER TABLE public.chat_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own chat turns"
ON public.chat_turns FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users create own chat turns"
ON public.chat_turns FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own chat turns"
ON public.chat_turns FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own chat turns"
ON public.chat_turns FOR DELETE TO authenticated
USING (auth.uid() = user_id);