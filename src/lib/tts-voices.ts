/**
 * Prebuilt Gemini-TTS voices, grouped so the picker can show US female and US
 * male voices separately. Ids must match Google's prebuilt voice names.
 */
export const TTS_VOICES = [
  // Female
  { id: "Kore", label: "Kore", description: "Female — firm and composed", gender: "female" },
  { id: "Aoede", label: "Aoede", description: "Female — light and breezy", gender: "female" },
  { id: "Leda", label: "Leda", description: "Female — youthful and bright", gender: "female" },
  { id: "Autonoe", label: "Autonoe", description: "Female — upbeat and clear", gender: "female" },
  { id: "Callirrhoe", label: "Callirrhoe", description: "Female — easygoing", gender: "female" },
  { id: "Despina", label: "Despina", description: "Female — smooth and even", gender: "female" },
  { id: "Achernar", label: "Achernar", description: "Female — soft and gentle", gender: "female" },
  { id: "Sulafat", label: "Sulafat", description: "Female — warm and inviting", gender: "female" },
  { id: "Vindemiatrix", label: "Vindemiatrix", description: "Female — calm and kind", gender: "female" },
  { id: "Erinome", label: "Erinome", description: "Female — crisp and neutral", gender: "female" },
  // Male
  { id: "Charon", label: "Charon", description: "Male — clear and informative", gender: "male" },
  { id: "Fenrir", label: "Fenrir", description: "Male — energetic and deep", gender: "male" },
  { id: "Puck", label: "Puck", description: "Male — lively and upbeat", gender: "male" },
  { id: "Orus", label: "Orus", description: "Male — firm and steady", gender: "male" },
  { id: "Iapetus", label: "Iapetus", description: "Male — clear and mellow", gender: "male" },
  { id: "Enceladus", label: "Enceladus", description: "Male — breathy and relaxed", gender: "male" },
  { id: "Algieba", label: "Algieba", description: "Male — smooth and rounded", gender: "male" },
  { id: "Umbriel", label: "Umbriel", description: "Male — easygoing and low", gender: "male" },
  { id: "Achird", label: "Achird", description: "Male — friendly and casual", gender: "male" },
  { id: "Rasalgethi", label: "Rasalgethi", description: "Male — informative narrator", gender: "male" },
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number]["id"];
export const DEFAULT_TTS_VOICE: TtsVoice = "Kore";

export function isTtsVoice(value: unknown): value is TtsVoice {
  return TTS_VOICES.some((voice) => voice.id === value);
}
