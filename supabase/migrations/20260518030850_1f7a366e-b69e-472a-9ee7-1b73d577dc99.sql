ALTER TABLE public.sentences
  ADD COLUMN linked_document_id UUID NULL
    REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sentences_linked_document
  ON public.sentences (linked_document_id)
  WHERE linked_document_id IS NOT NULL;