CREATE OR REPLACE FUNCTION public.move_sentence(p_document_id uuid, p_from_index integer, p_to_index integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
    -- Moving down: shift the block (v_from+1 .. v_to) up by 1, in order.
    UPDATE public.sentences
    SET order_index = -(order_index + 100)
    WHERE document_id = p_document_id
      AND order_index BETWEEN v_from + 1 AND v_to;

    UPDATE public.sentences
    SET order_index = (-order_index - 100) - 1
    WHERE document_id = p_document_id
      AND order_index <= -100;
  ELSE
    -- Moving up: shift the block (v_to .. v_from-1) down by 1, in order.
    UPDATE public.sentences
    SET order_index = -(order_index + 100)
    WHERE document_id = p_document_id
      AND order_index BETWEEN v_to AND v_from - 1;

    UPDATE public.sentences
    SET order_index = (-order_index - 100) + 1
    WHERE document_id = p_document_id
      AND order_index <= -100;
  END IF;

  -- Place the moving row at its new position.
  UPDATE public.sentences SET order_index = v_to WHERE id = v_moving_id;
END;
$function$;