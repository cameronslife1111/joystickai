-- 1. chat_threads
CREATE TABLE public.chat_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  attached_document_ids text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT jsonb_build_object(
    'web_search', true,
    'image_analysis', true,
    'planning', true,
    'image_generation', true,
    'video_generation', true,
    'document_editing', true
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_threads TO authenticated;
GRANT ALL ON public.chat_threads TO service_role;

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own chat threads"
ON public.chat_threads FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER chat_threads_touch_updated_at
BEFORE UPDATE ON public.chat_threads
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX chat_threads_user_id_updated_at_idx
ON public.chat_threads (user_id, updated_at DESC);

-- 2. chat_messages: add thread linkage + kind + plan reference
ALTER TABLE public.chat_messages
  ADD COLUMN thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  ADD COLUMN plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  ADD COLUMN kind text NOT NULL DEFAULT 'text';

-- Backfill: one default thread per user that already has messages, then assign.
WITH users_with_msgs AS (
  SELECT DISTINCT user_id FROM public.chat_messages
), new_threads AS (
  INSERT INTO public.chat_threads (user_id, title)
  SELECT user_id, 'Chat' FROM users_with_msgs
  RETURNING id, user_id
)
UPDATE public.chat_messages m
SET thread_id = t.id
FROM new_threads t
WHERE m.user_id = t.user_id AND m.thread_id IS NULL;

ALTER TABLE public.chat_messages ALTER COLUMN thread_id SET NOT NULL;

CREATE INDEX chat_messages_thread_id_created_at_idx
ON public.chat_messages (thread_id, created_at ASC);

-- 3. plans: link a run to a chat thread
ALTER TABLE public.plans
  ADD COLUMN thread_id uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL;