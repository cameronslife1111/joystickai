-- =====================================================================
-- Golden rule: sentences.order_index must always be a dense 0..N-1 range
-- per document. This migration:
--   1. Adds compact_sentence_indexes(doc) helper.
--   2. Patches insert_sentences_at and move_sentence to compact first.
--   3. Adds an AFTER DELETE trigger to auto-compact on any deletion.
--   4. Runs a one-shot cleanup over every document with sparse indexes
--      (including the doc currently stuck at order_index = 1,000,012).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper: compact a document's sentence order_index to 0..N-1.
--    Preserves current relative order (order_index ASC, created_at ASC).
--    Uses the same two-phase negative-bucket trick as the other RPCs to
--    avoid the unique (document_id, order_index) constraint.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compact_sentence_indexes(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*)::int INTO v_count
  FROM public.sentences
  WHERE document_id = p_document_id;

  IF v_count = 0 THEN RETURN; END IF;

  -- Phase 1: park every row in a unique negative slot derived from its
  -- target dense rank. Use a CTE to compute the new index once, then
  -- write the negative value (-(new_idx + 1)) so two rows never collide.
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

  -- Phase 2: pull rows back to their positive dense index.
  UPDATE public.sentences
  SET order_index = (-order_index) - 1
  WHERE document_id = p_document_id
    AND order_index < 0;
END;
$$;

-- ---------------------------------------------------------------------
-- 2a. Patch insert_sentences_at to compact first. After compaction,
--     p_insert_at is unambiguously a display position 0..N.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_sentences_at(
  p_document_id uuid,
  p_contents text[],
  p_insert_at integer
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
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

  -- GOLDEN RULE: compact existing rows to 0..N-1 before doing any math
  -- on p_insert_at. Without this, sparse order_index values (from prior
  -- deletes or stranded park-rows) cause "insert at bottom" to actually
  -- land before the previous last sentence — a visible reorder.
  PERFORM public.compact_sentence_indexes(p_document_id);

  SELECT count(*)::int INTO v_existing FROM public.sentences WHERE document_id = p_document_id;
  v_pos := GREATEST(0, LEAST(p_insert_at, v_existing));

  -- Phase A: push affected rows into a unique negative bucket that mirrors
  -- their original index. Using -(order_index + 1) avoids collisions with
  -- the unique (document_id, order_index) index.
  UPDATE public.sentences
  SET order_index = -(order_index + 1)
  WHERE document_id = p_document_id
    AND order_index >= v_pos;

  -- Phase B: pull them back at original_index + v_n.
  UPDATE public.sentences
  SET order_index = (-order_index - 1) + v_n
  WHERE document_id = p_document_id
    AND order_index < 0;

  -- Phase C: insert the new block at [v_pos .. v_pos + v_n - 1].
  FOREACH v_content IN ARRAY p_contents LOOP
    INSERT INTO public.sentences (user_id, document_id, content, order_index)
    VALUES (v_user, p_document_id, v_content, v_pos + v_i);
    v_i := v_i + 1;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 2b. Patch move_sentence to compact first so v_from/v_to always
--     correspond to real rows (display positions).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_sentence(
  p_document_id uuid,
  p_from_index integer,
  p_to_index integer
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_count int;
  v_from int;
  v_to int;
  v_moving_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT user_id INTO v_owner FROM public.documents WHERE id = p_document_id;
  IF v_owner IS NULL OR v_owner <> v_user THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  -- GOLDEN RULE: compact first so the from/to display positions map 1:1
  -- to real order_index values.
  PERFORM public.compact_sentence_indexes(p_document_id);

  SELECT count(*)::int INTO v_count FROM public.sentences WHERE document_id = p_document_id;
  IF v_count = 0 THEN RETURN; END IF;

  v_from := GREATEST(0, LEAST(p_from_index, v_count - 1));
  v_to := GREATEST(0, LEAST(p_to_index, v_count - 1));
  IF v_from = v_to THEN RETURN; END IF;

  SELECT id INTO v_moving_id
  FROM public.sentences
  WHERE document_id = p_document_id AND order_index = v_from;
  IF v_moving_id IS NULL THEN RETURN; END IF;

  -- Park the moving row in a unique negative slot to free its order_index.
  UPDATE public.sentences SET order_index = -1 WHERE id = v_moving_id;

  IF v_to > v_from THEN
    UPDATE public.sentences
    SET order_index = -(order_index + 100)
    WHERE document_id = p_document_id
      AND order_index BETWEEN v_from + 1 AND v_to;

    UPDATE public.sentences
    SET order_index = (-order_index - 100) - 1
    WHERE document_id = p_document_id
      AND order_index <= -100;
  ELSE
    UPDATE public.sentences
    SET order_index = -(order_index + 100)
    WHERE document_id = p_document_id
      AND order_index BETWEEN v_to AND v_from - 1;

    UPDATE public.sentences
    SET order_index = (-order_index - 100) + 1
    WHERE document_id = p_document_id
      AND order_index <= -100;
  END IF;

  UPDATE public.sentences SET order_index = v_to WHERE id = v_moving_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. AFTER DELETE trigger: auto-compact each affected document so no
--    delete path (UI, AI tool, direct SQL) can leave gaps behind.
--    Uses a statement-level trigger with REFERENCING OLD TABLE so bulk
--    deletes only compact once per document.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sentences_compact_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc uuid;
BEGIN
  FOR v_doc IN SELECT DISTINCT document_id FROM deleted_rows LOOP
    PERFORM public.compact_sentence_indexes(v_doc);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sentences_compact_after_delete ON public.sentences;
CREATE TRIGGER trg_sentences_compact_after_delete
AFTER DELETE ON public.sentences
REFERENCING OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sentences_compact_after_delete();

-- ---------------------------------------------------------------------
-- 4. One-shot cleanup: compact every document that currently has sparse
--    or stranded order_index values (including the one stuck at
--    order_index = 1,000,012 from a failed commitFullEdit run).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_doc uuid;
BEGIN
  FOR v_doc IN
    SELECT document_id
    FROM public.sentences
    GROUP BY document_id
    HAVING max(order_index) <> count(*) - 1 OR min(order_index) <> 0
  LOOP
    PERFORM public.compact_sentence_indexes(v_doc);
  END LOOP;
END;
$$;