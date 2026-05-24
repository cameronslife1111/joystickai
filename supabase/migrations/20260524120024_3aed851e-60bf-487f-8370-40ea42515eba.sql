
CREATE OR REPLACE FUNCTION public.insert_sentences_at_as(
  p_user_id uuid,
  p_document_id uuid,
  p_contents text[],
  p_insert_at integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_existing int;
  v_pos int;
  v_n int;
  v_content text;
  v_i int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  SELECT user_id INTO v_owner FROM public.documents WHERE id = p_document_id;
  IF v_owner IS NULL OR v_owner <> p_user_id THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  v_n := COALESCE(array_length(p_contents, 1), 0);
  IF v_n = 0 THEN RETURN; END IF;

  PERFORM public.compact_sentence_indexes(p_document_id);

  SELECT count(*)::int INTO v_existing FROM public.sentences WHERE document_id = p_document_id;
  v_pos := GREATEST(0, LEAST(p_insert_at, v_existing));

  UPDATE public.sentences
  SET order_index = -(order_index + 1)
  WHERE document_id = p_document_id
    AND order_index >= v_pos;

  UPDATE public.sentences
  SET order_index = (-order_index - 1) + v_n
  WHERE document_id = p_document_id
    AND order_index < 0;

  FOREACH v_content IN ARRAY p_contents LOOP
    INSERT INTO public.sentences (user_id, document_id, content, order_index)
    VALUES (p_user_id, p_document_id, v_content, v_pos + v_i);
    v_i := v_i + 1;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_sentences_at_as(uuid, uuid, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_sentences_at_as(uuid, uuid, text[], integer) TO service_role;
