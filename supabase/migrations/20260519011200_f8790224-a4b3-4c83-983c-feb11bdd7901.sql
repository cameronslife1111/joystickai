ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS last_favorite_slot integer;