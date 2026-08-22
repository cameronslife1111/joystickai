import { afterEach, describe, expect, test } from "bun:test";
import {
  cancelSpeech,
  cleanForSpeech,
  isWebKitMobile,
  speakText,
  speechDiagnostics,
} from "../src/lib/speech";

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth {
  speaking = false;
  pending = false;
  paused = false;
  cancelCalls = 0;
  utterances: FakeUtterance[] = [];

  speak(utterance: FakeUtterance) {
    this.utterances.push(utterance);
  }

  cancel() {
    this.cancelCalls += 1;
    this.speaking = false;
    this.pending = false;
  }

  resume() {
    this.paused = false;
  }

  getVoices() {
    return [];
  }
}

function installBrowser(speechSynthesis: FakeSynth, userAgent = "Mozilla/5.0 (Macintosh) Chrome") {
  Object.assign(globalThis, {
    window: Object.assign(globalThis, {
      speechSynthesis,
      setTimeout,
      clearTimeout,
    }),
    navigator: { userAgent, maxTouchPoints: 0 },
    SpeechSynthesisUtterance: FakeUtterance,
  });
}

afterEach(() => cancelSpeech());

describe("sentence speech", () => {
  test("desktop keeps the free built-in voice", () => {
    const engine = new FakeSynth();
    installBrowser(engine);

    expect(isWebKitMobile()).toBe(false);
    expect(speakText("Read this sentence.")).toBe(true);
    expect(engine.cancelCalls).toBe(0);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Read this sentence."]);
  });

  test("leaves voice and language unset so the system default is used", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Use my default voice.");

    const utterance = engine.utterances[0] as FakeUtterance & { voice?: unknown; lang?: string };
    expect(utterance.voice).toBeUndefined();
    expect(utterance.lang).toBeUndefined();
  });

  test("replacing active speech cancels once and speaks the newest sentence", () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    installBrowser(engine);

    speakText("Newest sentence.");
    expect(engine.cancelCalls).toBe(1);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Newest sentence."]);
  });

  test("iPhone skips the built-in engine and uses audio playback", () => {
    const engine = new FakeSynth();
    installBrowser(engine, "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) CriOS/140");

    expect(isWebKitMobile()).toBe(true);
    expect(speakText("Speak on my phone.")).toBe(true);
    expect(engine.utterances).toHaveLength(0);
    expect(speechDiagnostics().some((entry) => entry.event === "audio requested")).toBe(true);
  });

  test("a silently dropped desktop utterance falls back to audio playback", async () => {
    const engine = new FakeSynth();
    installBrowser(engine);

    speakText("This will be dropped.");
    expect(engine.utterances).toHaveLength(1);
    await Bun.sleep(1000);
    const events = speechDiagnostics().map((entry) => entry.event);
    expect(events).toContain("synth silent drop");
    expect(events).toContain("audio requested");
  });

  test("rejects emoji-only content", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    expect(cleanForSpeech("🐝  hello  🟢")).toBe("hello");
    expect(speakText("🐝🟢")).toBe(false);
    expect(engine.utterances).toHaveLength(0);
  });
});
