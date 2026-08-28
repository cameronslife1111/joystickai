ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_tts_voice_allowed;

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_tts_voice_allowed CHECK (
  tts_voice IS NULL OR tts_voice = ANY (ARRAY[
    'Kore','Aoede','Leda','Autonoe','Callirrhoe','Despina','Achernar','Sulafat','Vindemiatrix','Erinome',
    'Charon','Fenrir','Puck','Orus','Iapetus','Enceladus','Algieba','Umbriel','Achird','Rasalgethi'
  ]::text[])
);