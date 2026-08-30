ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS auto_attach_document_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];