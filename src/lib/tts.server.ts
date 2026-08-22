// Server-only text-to-speech helper. Turns a sentence into MP3 bytes using
// Lovable AI, returned as base64 so the browser can play it from a data URL
// with a single, already-unlocked <audio> element (the only playback path iOS
// honors reliably).

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/speech";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function synthesizeMp3(text: string, voice: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      input: text,
      voice,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`TTS failed: ${response.status} ${detail}`.trim());
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("TTS returned no audio");
  return toBase64(bytes);
}
