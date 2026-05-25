-- Atomic full-doc edit save.
-- Replaces the client's 4-round-trip park/reuse/insert/delete dance with a
-- single transaction so a mid-save network handoff (Wi-Fi <-> cellular)
-- cannot leave rows parked at high order_index values or duplicated.

CREATE OR REPLACE FUNCTION public.commit_document_edit(
  p_document_id uuid,
  p_contents text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_n int;
  v_final int;
  v_max int;
  v_min int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT user_id INTO v_owner FROM public.documents WHERE id = p_document_id;
  IF v_owner IS NULL OR v_owner <> v_user THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  v_n := COALESCE(array_length(p_contents, 1), 0);

  -- Empty target: nuke all rows.
  IF v_n = 0 THEN
    DELETE FROM public.sentences WHERE document_id = p_document_id;
    RETURN;
  END IF;

  -- Compact existing rows to 0..M-1 so closest-by-order matching is meaningful.
  PERFORM public.compact_sentence_indexes(p_document_id);

  -- Materialize the requested parts with their target index.
  CREATE TEMP TABLE _parts (
    new_idx int PRIMARY KEY,
    content text NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO _parts (new_idx, content)
  SELECT g.ord - 1, p_contents[g.ord]
  FROM generate_series(1, v_n) AS g(ord);

  -- Snapshot existing rows (id, content, current dense order_index).
  CREATE TEMP TABLE _existing (
    id uuid PRIMARY KEY,
    content text NOT NULL,
    order_index int NOT NULL,
    claimed boolean NOT NULL DEFAULT false,
    new_idx int
  ) ON COMMIT DROP;
  INSERT INTO _existing (id, content, order_index)
  SELECT s.id, s.content, s.order_index
  FROM public.sentences s
  WHERE s.document_id = p_document_id;

  -- Identity-preserving diff. For each new part in order, pick the unclaimed
  -- existing row with matching content whose current order_index is closest
  -- to the part's new index. Ties broken by smaller order_index, then by id
  -- for determinism. Mirrors the JS algorithm in commitFullEdit.
  PERFORM 1 FROM _parts ORDER BY new_idx;
  DECLARE
    r record;
    v_pick uuid;
  BEGIN
    FOR r IN SELECT new_idx, content FROM _parts ORDER BY new_idx LOOP
      SELECT e.id INTO v_pick
      FROM _existing e
      WHERE e.claimed = false AND e.content = r.content
      ORDER BY abs(e.order_index - r.new_idx) ASC, e.order_index ASC, e.id ASC
      LIMIT 1;
      IF v_pick IS NOT NULL THEN
        UPDATE _existing SET claimed = true, new_idx = r.new_idx WHERE id = v_pick;
      END IF;
    END LOOP;
  END;

  -- Phase 1: park every existing row at a unique negative slot derived from
  -- its (final) new_idx or its current order_index for surplus rows.
  -- Using -(target+1) (offset by v_n for surplus to keep them distinct)
  -- guarantees no collisions with the positive (document_id, order_index)
  -- unique index.
  UPDATE public.sentences s
  SET order_index = CASE
    WHEN e.claimed THEN -(e.new_idx + 1)
    ELSE -(v_n + e.order_index + 1)
  END
  FROM _existing e
  WHERE s.id = e.id;

  -- Phase 2: pull reused rows back to their positive new_idx.
  UPDATE public.sentences s
  SET order_index = e.new_idx
  FROM _existing e
  WHERE s.id = e.id AND e.claimed = true;

  -- Phase 3: insert brand-new rows at the slots no existing row claimed.
  INSERT INTO public.sentences (user_id, document_id, content, order_index)
  SELECT v_user, p_document_id, p.content, p.new_idx
  FROM _parts p
  WHERE NOT EXISTS (
    SELECT 1 FROM _existing e WHERE e.claimed = true AND e.new_idx = p.new_idx
  );

  -- Phase 4: delete unclaimed originals (still at negative parked slots).
  DELETE FROM public.sentences s
  USING _existing e
  WHERE s.id = e.id AND e.claimed = false;

  -- Final invariant check (transaction rolls back on failure).
  SELECT count(*)::int, COALESCE(max(order_index), -1), COALESCE(min(order_index), 0)
  INTO v_final, v_max, v_min
  FROM public.sentences WHERE document_id = p_document_id;

  IF v_final <> v_n OR v_max <> v_n - 1 OR v_min <> 0 THEN
    RAISE EXCEPTION 'commit_document_edit invariant failed: count=% max=% min=% expected n=%',
      v_final, v_max, v_min, v_n;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commit_document_edit(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_document_edit(uuid, text[]) TO authenticated;

-- One-shot cleanup: compact every document that currently has either a
-- stranded high-range row (>=1_000_000) or a gap/duplicate in its
-- order_index sequence. compact_sentence_indexes is idempotent.
DO $$
DECLARE
  v_doc uuid;
BEGIN
  FOR v_doc IN
    SELECT DISTINCT document_id FROM public.sentences WHERE order_index >= 1000000
    UNION
    SELECT document_id
    FROM public.sentences
    GROUP BY document_id
    HAVING max(order_index) <> count(*) - 1 OR min(order_index) <> 0
  LOOP
    PERFORM public.compact_sentence_indexes(v_doc);
  END LOOP;
END
$$;