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
  IF v_n = 0 THEN RETURN; END IF;

  SELECT count(*)::int INTO v_existing FROM public.sentences WHERE document_id = p_document_id;
  v_pos := GREATEST(0, LEAST(p_insert_at, v_existing));

  -- IMPORTANT: This function MUST preserve the original order of existing
  -- sentences. Never globally re-rank or sort them. Only the rows at or after
  -- the insertion point move, and they move by exactly v_n — preserving their
  -- relative order one-to-one.

  -- Phase A: push affected rows into a unique negative bucket that mirrors
  -- their original index. Using -(order_index + 1) avoids collisions with the
  -- unique (document_id, order_index) index and keeps each row's original
  -- position recoverable.
  UPDATE public.sentences
  SET order_index = -(order_index + 1)
  WHERE document_id = p_document_id
    AND order_index >= v_pos;

  -- Phase B: pull them back up at original_index + v_n, restoring their exact
  -- relative order — no sorting, no re-ranking.
  UPDATE public.sentences
  SET order_index = (-order_index - 1) + v_n
  WHERE document_id = p_document_id
    AND order_index < 0;

  -- Phase C: insert the new block at [v_pos .. v_pos + v_n - 1], in the
  -- exact order the user provided. Plain paste, nothing clever.
  FOREACH v_content IN ARRAY p_contents LOOP
    INSERT INTO public.sentences (user_id, document_id, content, order_index)
    VALUES (v_user, p_document_id, v_content, v_pos + v_i);
    v_i := v_i + 1;
  END LOOP;
END;
$$;