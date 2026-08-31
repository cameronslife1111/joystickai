ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS tts_prefetch smallint NOT NULL DEFAULT 2;

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_tts_prefetch_range;

ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_tts_prefetch_range CHECK (tts_prefetch >= 0 AND tts_prefetch <= 2);