-- One-time reindex: rewrite order_index per document to 0..N-1 with a stable tiebreaker.
WITH ranked AS (
  SELECT id,
         (row_number() OVER (PARTITION BY document_id ORDER BY order_index, created_at, id) - 1)::int AS new_idx
  FROM public.sentences
)
UPDATE public.sentences s
SET order_index = r.new_idx
FROM ranked r
WHERE s.id = r.id AND s.order_index IS DISTINCT FROM r.new_idx;

-- Enforce uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS sentences_doc_order_uidx
  ON public.sentences (document_id, order_index);