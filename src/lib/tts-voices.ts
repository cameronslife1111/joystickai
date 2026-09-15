/** OpenAI's supported built-in gpt-4o-mini-tts voices. */
export const TTS_VOICES = [
  { id: "alloy", label: "Alloy", description: "Balanced and versatile" },
  { id: "ash", label: "Ash", description: "Clear and conversational" },
  { id: "ballad", label: "Ballad", description: "Warm and expressive" },
  { id: "coral", label: "Coral", description: "Bright and natural" },
  { id: "echo", label: "Echo", description: "Smooth and composed" },
  { id: "fable", label: "Fable", description: "Expressive storyteller" },
  { id: "onyx", label: "Onyx", description: "Deep and steady" },
  { id: "nova", label: "Nova", description: "Friendly and energetic" },
  { id: "sage", label: "Sage", description: "Calm and measured" },
  { id: "shimmer", label: "Shimmer", description: "Light and polished" },
  { id: "verse", label: "Verse", description: "Natural and engaging" },
  { id: "marin", label: "Marin", description: "Rich and articulate" },
  { id: "cedar", label: "Cedar", description: "Grounded and clear" },
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number]["id"];
export const DEFAULT_TTS_VOICE: TtsVoice = "coral";

export function isTtsVoice(value: unknown): value is TtsVoice {
  return TTS_VOICES.some((voice) => voice.id === value);
}
