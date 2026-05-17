-- Replace insert_sentences_at with a version that preserves original order.
-- IMPORTANT: This function must NEVER reorder, reverse, or re-rank existing
-- sentences. It only shifts rows AT OR AFTER the insertion point by the size
-- of the new block, then inserts the new block as a contiguous range.
CREATE OR REPLACE FUNCTION public.insert_sentences_at(
  p_document_id uuid,
  p_contents text[],
  p_insert_at int
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_existing int;
  v_pos int;
  v_n int;
  v_content text;
  v_i int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT user_id INTO v_owner FROM public.documents WHERE id = p_document_id;
  IF v_owner IS NULL OR v_owner <> v_user THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  v_n := COALESCE(array_length(p_contents, 1), 0);
  IF v_n = 0 THEN
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_existing FROM public.sentences WHERE document_id = p_document_id;
  v_pos := GREATEST(0, LEAST(p_insert_at, v_existing));

  -- Step 1: shift rows at or after the insertion point UP by v_n, preserving
  -- their relative order. We do this in descending order to avoid collisions
  -- with the unique (document_id, order_index) index.
  --
  -- DO NOT replace this with a global re-rank — that has historically caused
  -- the entire document to flip upside down. Only the tail moves.
  UPDATE public.sentences
  SET order_index = order_index + v_n
  WHERE document_id = p_document_id
    AND order_index >= v_pos;

  -- Step 2: insert the new block at [v_pos .. v_pos + v_n - 1], in the order
  -- the user provided. No sorting, no reordering — just a plain paste.
  FOREACH v_content IN ARRAY p_contents LOOP
    INSERT INTO public.sentences (user_id, document_id, content, order_index)
    VALUES (v_user, p_document_id, v_content, v_pos + v_i);
    v_i := v_i + 1;
  END LOOP;
END;
$$;