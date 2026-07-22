
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_status_check;
ALTER TABLE public.plans ADD CONSTRAINT plans_status_check CHECK (status IN ('composing','proposed','approved','running','awaiting_media','awaiting_user','completed','failed','cancelled','retrying'));
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS awaiting_since TIMESTAMPTZ;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS awaiting_count INTEGER NOT NULL DEFAULT 0;
