-- Revoke EXECUTE on the new SECURITY DEFINER helpers from anon/authenticated.
-- They are only meant to be called internally by insert_sentences_at,
-- move_sentence, and the AFTER DELETE trigger.
REVOKE EXECUTE ON FUNCTION public.compact_sentence_indexes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sentences_compact_after_delete() FROM PUBLIC, anon, authenticated;