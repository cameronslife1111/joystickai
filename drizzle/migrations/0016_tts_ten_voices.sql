ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_tts_voice_allowed;
UPDATE public.user_preferences SET tts_voice = NULL WHERE tts_voice IS NOT NULL AND tts_voice NOT IN ('Charon','Fenrir','Puck','Orus','Iapetus','Kore','Aoede','Leda','Zephyr','Autonoe');
ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_tts_voice_allowed
CHECK (tts_voice IS NULL OR tts_voice IN ('Charon','Fenrir','Puck','Orus','Iapetus','Kore','Aoede','Leda','Zephyr','Autonoe'));
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS tts_high_quality boolean NOT NULL DEFAULT false;