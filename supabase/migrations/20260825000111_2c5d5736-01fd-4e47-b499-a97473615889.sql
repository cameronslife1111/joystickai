ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS tts_voice text;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_tts_voice_allowed
CHECK (tts_voice IS NULL OR tts_voice IN ('Charon', 'Fenrir', 'Kore', 'Aoede'));

COMMENT ON COLUMN public.user_preferences.tts_voice IS 'Selected Lovable AI Google TTS prebuilt voice.';