ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_tts_voice_allowed;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_tts_voice_allowed
CHECK (
  tts_voice IS NULL OR tts_voice IN (
    'Kore', 'Aoede', 'Leda', 'Autonoe', 'Callirrhoe', 'Despina', 'Achernar', 'Sulafat', 'Vindemiatrix', 'Erinome',
    'Charon', 'Fenrir', 'Puck', 'Orus', 'Iapetus', 'Enceladus', 'Algieba', 'Umbriel', 'Achird', 'Rasalgethi',
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
  )
);

COMMENT ON COLUMN public.user_preferences.tts_voice IS 'Selected OpenAI text-to-speech voice; legacy Google values fall back to the current default.';