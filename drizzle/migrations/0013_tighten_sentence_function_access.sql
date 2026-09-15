-- Ownership guard inside the index compactor so it can never be pointed at
-- another account's document. auth.uid() IS NULL means a trusted service-role
-- call (the plan runner / scheduler), which is already server-side only.
CREATE OR REPLACE FUNCTION public.compact_sentence_indexes(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_owner uuid;
  v_user uuid := auth.uid();
BEGIN
  SELECT user_id INTO v_owner FROM public.documents WHERE id = p_document_id;
  IF v_owner IS NULL THEN RETURN; END IF;
  IF v_user IS NOT NULL AND v_owner <> v_user THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM public.sentences
  WHERE document_id = p_document_id;

  IF v_count = 0 THEN RETURN; END IF;

  WITH ranked AS (
    SELECT id,
           (row_number() OVER (ORDER BY order_index ASC, created_at ASC) - 1)::int AS new_idx
    FROM public.sentences
    WHERE document_id = p_document_id
  )
  UPDATE public.sentences s
  SET order_index = -(ranked.new_idx + 1)
  FROM ranked
  WHERE s.id = ranked.id;

  UPDATE public.sentences
  SET order_index = (-order_index) - 1
  WHERE document_id = p_document_id
    AND order_index < 0;
END;
$function$;

-- Nothing in the app calls these without a session; drop anon execute rights.
REVOKE EXECUTE ON FUNCTION public.compact_sentence_indexes(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.document_sentence_counts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_sentences_at(uuid, text[], integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.move_sentence(uuid, integer, integer) FROM anon;
