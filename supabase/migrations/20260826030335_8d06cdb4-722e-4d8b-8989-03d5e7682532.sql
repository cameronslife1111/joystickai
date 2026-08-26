ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS last_assistant_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

UPDATE public.chat_threads
SET last_assistant_at = COALESCE(last_assistant_at, updated_at),
    last_read_at = COALESCE(last_read_at, updated_at)
WHERE last_assistant_at IS NULL OR last_read_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_threads_user_activity_idx
  ON public.chat_threads (user_id, last_assistant_at DESC);