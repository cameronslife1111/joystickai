CREATE OR REPLACE FUNCTION public.document_sentence_counts()
RETURNS TABLE (document_id uuid, sentence_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.document_id, count(*)::int
  FROM public.sentences s
  WHERE s.user_id = auth.uid()
  GROUP BY s.document_id
$$;

GRANT EXECUTE ON FUNCTION public.document_sentence_counts() TO authenticated;