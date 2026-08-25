import { describe, expect, test } from "bun:test";
import { cleanForSpeech, speakText } from "../src/lib/speech";
import { DEFAULT_TTS_VOICE, isTtsVoice, TTS_VOICES } from "../src/lib/tts-voices";

describe("hosted sentence speech", () => {
  test("exposes four supported Google voices with a valid default", () => {
    expect(TTS_VOICES.map((voice) => voice.id)).toEqual(["Charon", "Fenrir", "Kore", "Aoede"]);
    expect(isTtsVoice(DEFAULT_TTS_VOICE)).toBe(true);
    expect(isTtsVoice("not-a-voice")).toBe(false);
  });

  test("removes emoji and normalizes whitespace", () => {
    expect(cleanForSpeech("🐝  hello   world  🟢")).toBe("hello world");
  });

  test("rejects emoji-only content before starting audio", () => {
    expect(speakText("🐝🟢")).toBe(false);
  });
});