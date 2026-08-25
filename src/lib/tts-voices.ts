export const TTS_VOICES = [
  { id: "Charon", label: "Charon", description: "Clear and informative" },
  { id: "Fenrir", label: "Fenrir", description: "Energetic and deep" },
  { id: "Kore", label: "Kore", description: "Firm and composed" },
  { id: "Aoede", label: "Aoede", description: "Light and breezy" },
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number]["id"];
export const DEFAULT_TTS_VOICE: TtsVoice = "Kore";

export function isTtsVoice(value: unknown): value is TtsVoice {
  return TTS_VOICES.some((voice) => voice.id === value);
}