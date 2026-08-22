import { afterEach, describe, expect, test } from "bun:test";
import { cancelSpeech, cleanForSpeech, speakText } from "../src/lib/speech";

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

function installBrowser(speechSynthesis: FakeSynth) {
  Object.assign(globalThis, {
    window: Object.assign(globalThis, {
      speechSynthesis,
      setTimeout,
      clearTimeout,
    }),
    SpeechSynthesisUtterance: FakeUtterance,
  });
}

afterEach(() => cancelSpeech());

describe("sentence speech", () => {
  test("submits an idle first swipe immediately without cancelling", () => {
    const engine = new FakeSynth();
    installBrowser(engine);

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

  test("cancels active speech and submits the replacement after settling", async () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    installBrowser(engine);

    speakText("Newest sentence.");
    expect(engine.cancelCalls).toBe(1);
    expect(engine.utterances).toHaveLength(0);
    await Bun.sleep(35);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Newest sentence."]);
  });

  test("coalesces rapid replacement requests to the newest sentence", async () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    installBrowser(engine);

    speakText("Older sentence.");
    speakText("Newest sentence.");
    await Bun.sleep(35);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Newest sentence."]);
  });

  test("retries once when the browser silently drops an idle utterance", async () => {
    const engine = new FakeSynth();
    installBrowser(engine);

    speakText("Retry this sentence.");
    await Bun.sleep(550);
    expect(engine.utterances).toHaveLength(2);
    await Bun.sleep(550);
    expect(engine.utterances).toHaveLength(2);
  });

  test("rejects emoji-only content", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    expect(cleanForSpeech("🐝  hello  🟢")).toBe("hello");
    expect(speakText("🐝🟢")).toBe(false);
    expect(engine.utterances).toHaveLength(0);
  });
});