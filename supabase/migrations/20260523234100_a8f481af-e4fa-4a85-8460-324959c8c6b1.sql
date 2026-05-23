ALTER TABLE public.sentences ADD COLUMN pending_delete boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_sentences_pending_delete ON public.sentences (document_id, pending_delete);