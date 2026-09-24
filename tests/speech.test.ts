import { describe, expect, test, beforeEach } from "bun:test";
import { cleanForSpeech, speakText, setSpeechEnabled, setSpeechSuppressed, isSpeaking, cancelSpeech, setSpeechVoice, getSpeechVoice } from "../src/lib/speech";

describe("speech", () => {
  beforeEach(() => { setSpeechEnabled(false); setSpeechSuppressed(false); });

  test("strips emoji and whitespace", () => {
    expect(cleanForSpeech("  Hi 😀  there ")).toBe("Hi there");
  });
  test("does nothing when sound is off", () => {
    expect(speakText("Hello")).toBe(false);
  });
  test("does nothing while suppressed", () => {
    setSpeechEnabled(true);
    setSpeechSuppressed(true);
    expect(speakText("Hello")).toBe(false);
  });
  test("ignores unpronounceable text", () => {
    setSpeechEnabled(true);
    expect(speakText("😀 ...")).toBe(false);
  });
  test("voice selection validates ids", () => {
    setSpeechVoice("Puck");
    expect(getSpeechVoice()).toBe("Puck");
    setSpeechVoice("Nope");
    expect(getSpeechVoice()).toBe("Puck");
  });
  test("cancel leaves nothing playing", () => {
    cancelSpeech();
    expect(isSpeaking()).toBe(false);
  });
});
