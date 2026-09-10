ALTER TABLE public.plans DROP CONSTRAINT plans_status_check;
ALTER TABLE public.plans ADD CONSTRAINT plans_status_check CHECK (
  status = ANY (ARRAY['composing','proposed','approved','running','awaiting_media','awaiting_user','awaiting_vc','completed','failed','cancelled','retrying'])
);