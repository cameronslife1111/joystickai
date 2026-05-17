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

  SELECT count(*)::int INTO v_existing FROM public.sentences WHERE document_id = p_document_id;
  v_pos := GREATEST(0, LEAST(p_insert_at, v_existing));

  -- Step 1: push all existing rows to safe negative temporary indices to avoid
  -- collisions with the unique (document_id, order_index) index.
  UPDATE public.sentences
  SET order_index = -1000000 - order_index
  WHERE document_id = p_document_id;

  -- Step 2: write final indices for rows BEFORE the insertion point (0..v_pos-1).
  WITH ranked AS (
    SELECT id,
           (row_number() OVER (ORDER BY order_index, created_at, id) - 1)::int AS rn
    FROM public.sentences
    WHERE document_id = p_document_id
  )
  UPDATE public.sentences s
  SET order_index = r.rn
  FROM ranked r
  WHERE s.id = r.id AND r.rn < v_pos;

  -- Step 3: write final indices for rows AFTER the insertion point, shifted by
  -- the length of the new block.
  WITH ranked AS (
    SELECT id,
           (row_number() OVER (ORDER BY order_index, created_at, id) - 1)::int AS rn
    FROM public.sentences
    WHERE document_id = p_document_id AND order_index < 0
  )
  UPDATE public.sentences s
  SET order_index = r.rn + array_length(p_contents, 1)
  FROM ranked r
  WHERE s.id = r.id;

  -- Step 4: insert the new block.
  FOREACH v_content IN ARRAY p_contents LOOP
    INSERT INTO public.sentences (user_id, document_id, content, order_index)
    VALUES (v_user, p_document_id, v_content, v_pos + v_i);
    v_i := v_i + 1;
  END LOOP;
END;
$$;