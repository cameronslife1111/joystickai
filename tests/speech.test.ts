import { afterEach, describe, expect, test } from "bun:test";
import { cancelSpeech, cleanForSpeech, isSpeaking, speakText } from "../src/lib/speech";

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  voice?: unknown;
  lang?: string;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth {
  cancelCalls = 0;
  utterances: FakeUtterance[] = [];

  speak(utterance: FakeUtterance) {
    this.utterances.push(utterance);
  }

  cancel() {
    this.cancelCalls += 1;
  }
}

function installBrowser(speechSynthesis: FakeSynth) {
  Object.assign(globalThis, {
    window: Object.assign(globalThis, { speechSynthesis }),
    SpeechSynthesisUtterance: FakeUtterance,
  });
}

afterEach(() => cancelSpeech());

describe("native browser sentence speech", () => {
  test("speaks the first native utterance immediately without cancelling", () => {
    const engine = new FakeSynth();
    installBrowser(engine);

    expect(speakText("Read this sentence.")).toBe(true);
    expect(engine.cancelCalls).toBe(0);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Read this sentence."]);
  });

  test("uses the browser default voice without selecting a voice or language", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Use the browser voice.");

    expect(engine.utterances[0]?.voice).toBeUndefined();
    expect(engine.utterances[0]?.lang).toBeUndefined();
  });

  test("keeps long text in one utterance", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    const long = `${"word ".repeat(300)}end.`.trim();

    speakText(long);

    expect(engine.utterances).toHaveLength(1);
    expect(engine.utterances[0]?.text).toBe(long);
  });

  test("replaces active speech synchronously in the same task", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Older sentence.");
    const stale = engine.utterances[0];

    speakText("Newest sentence.");

    expect(engine.cancelCalls).toBe(1);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Older sentence.", "Newest sentence."]);
    expect(stale?.onstart).toBeNull();
    expect(stale?.onend).toBeNull();
  });

  test("rapid replacements synchronously cancel before each newest utterance", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("First sentence.");
    speakText("Second sentence.");
    speakText("Third sentence.");

    expect(engine.cancelCalls).toBe(2);
    expect(engine.utterances.map((item) => item.text)).toEqual([
      "First sentence.",
      "Second sentence.",
      "Third sentence.",
    ]);
    expect(engine.utterances[1]?.onstart).toBeNull();
    expect(engine.utterances[1]?.onend).toBeNull();
  });

  test("explicit cancellation detaches the active native utterance", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("First sentence.");
    speakText("Never submit this sentence.");
    const active = engine.utterances[1];
    cancelSpeech();

    expect(engine.cancelCalls).toBe(2);
    expect(active?.onstart).toBeNull();
    expect(active?.onend).toBeNull();
    expect(isSpeaking()).toBe(false);
  });

  test("tracks native start and end callbacks", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    let ended = false;
    speakText("Track this sentence.", { onEnd: () => { ended = true; } });

    expect(isSpeaking()).toBe(false);
    engine.utterances[0]?.onstart?.();
    expect(isSpeaking()).toBe(true);
    engine.utterances[0]?.onend?.();
    expect(isSpeaking()).toBe(false);
    expect(ended).toBe(true);
  });

  test("reports a native utterance error without retrying", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    let failed = false;
    speakText("Do not retry this.", { onError: () => { failed = true; } });

    engine.utterances[0]?.onerror?.();

    expect(failed).toBe(true);
    expect(engine.utterances).toHaveLength(1);
    expect(isSpeaking()).toBe(false);
  });

  test("applies rate and pitch without changing the output path", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Configured speech.", { rate: 1.25, pitch: 0.9 });

    expect(engine.utterances[0]?.rate).toBe(1.25);
    expect(engine.utterances[0]?.pitch).toBe(0.9);
  });

  test("removes emoji and rejects emoji-only content", () => {
    const engine = new FakeSynth();
    installBrowser(engine);

    expect(cleanForSpeech("🐝  hello  🟢")).toBe("hello");
    expect(speakText("🐝🟢")).toBe(false);
    expect(engine.utterances).toHaveLength(0);
  });

  test("does not touch audio routing or create media objects", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    const writes: string[] = [];
    const audioSession = {
      get type() { return "auto"; },
      set type(value: string) { writes.push(value); },
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { audioSession },
    });

    speakText("Native speech only.");

    expect(writes).toEqual([]);
    expect(engine.utterances).toHaveLength(1);
  });
});