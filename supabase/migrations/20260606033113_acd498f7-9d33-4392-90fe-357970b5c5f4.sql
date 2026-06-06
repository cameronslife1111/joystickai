CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own chat_messages select" ON public.chat_messages
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own chat_messages insert" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own chat_messages delete" ON public.chat_messages
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX chat_messages_user_created_idx ON public.chat_messages (user_id, created_at);