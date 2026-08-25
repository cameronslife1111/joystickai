import { describe, expect, test } from "bun:test";
import {
  cleanForSpeech,
  resetSpeechCaches,
  SPEECH_RATE,
  speakText,
} from "../src/lib/speech";
import { DEFAULT_TTS_VOICE, isTtsVoice, TTS_VOICES } from "../src/lib/tts-voices";

describe("hosted sentence speech", () => {
  test("exposes four supported Google voices with a valid default", () => {
    expect(TTS_VOICES.map((voice) => voice.id)).toEqual(["Charon", "Fenrir", "Kore", "Aoede"]);
    expect(isTtsVoice(DEFAULT_TTS_VOICE)).toBe(true);
    expect(isTtsVoice("not-a-voice")).toBe(false);
  });

  test("removes emoji and normalizes whitespace without dropping latin letters", () => {
    expect(cleanForSpeech("🐝  hello   world  🟢")).toBe("hello world");
    expect(cleanForSpeech("þetta reddast")).toBe("þetta reddast");
  });

  test("plays every voice slightly faster than the model default", () => {
    expect(SPEECH_RATE).toBeGreaterThan(1);
    expect(SPEECH_RATE).toBeLessThanOrEqual(1.25);
  });

  test("rejects emoji-only content before starting audio", () => {
    expect(speakText("🐝🟢")).toBe(false);
  });

  test("never creates a media element and never throws when starting speech", () => {
    // Whether or not this environment has an AudioContext, speak must start
    // cleanly (or bail cleanly) and must not create any <audio> element.
    resetSpeechCaches();
    expect(typeof speakText("hello world")).toBe("boolean");
    expect(typeof document === "undefined" || !document.querySelector("audio")).toBe(true);
  });

  test("cache reset hook clears state without throwing", () => {
    expect(() => resetSpeechCaches()).not.toThrow();
  });
});
