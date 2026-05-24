REVOKE EXECUTE ON FUNCTION public.claim_due_schedule(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_schedule(uuid) TO service_role;