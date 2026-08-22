import { afterEach, describe, expect, test } from "bun:test";
import { cancelSpeech, cleanForSpeech, installSpeechUnlock, isSpeaking, prepareSpeechGesture, speakText } from "../src/lib/speech";

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onboundary: (() => void) | null = null;
  voice?: FakeVoice;
  lang?: string;

  constructor(text: string) {
    this.text = text;
  }
}

type FakeVoice = {
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
};

class FakeSynth {
  speaking = false;
  pending = false;
  paused = false;
  cancelCalls = 0;
  resumeCalls = 0;
  utterances: FakeUtterance[] = [];
  voices: FakeVoice[] = [];
  listeners = new Map<string, Set<() => void>>();

  speak(utterance: FakeUtterance) {
    this.utterances.push(utterance);
  }

  cancel() {
    this.cancelCalls += 1;
    this.speaking = false;
    this.pending = false;
  }

  resume() {
    this.resumeCalls += 1;
    this.paused = false;
  }

  getVoices() {
    return this.voices;
  }

  addEventListener(name: string, callback: () => void) {
    const callbacks = this.listeners.get(name) ?? new Set<() => void>();
    callbacks.add(callback);
    this.listeners.set(name, callbacks);
  }

  removeEventListener(name: string, callback: () => void) {
    this.listeners.get(name)?.delete(callback);
  }

  dispatch(name: string) {
    for (const callback of this.listeners.get(name) ?? []) callback();
  }
}

function installBrowser(speechSynthesis: FakeSynth, userAgent = "Desktop", audioSession?: { type: string; state?: string }) {
  Object.assign(globalThis, {
    window: Object.assign(globalThis, {
      speechSynthesis,
      setTimeout,
      clearTimeout,
      addEventListener: () => {},
    }),
    document: {
      visibilityState: "visible",
      addEventListener: () => {},
    },
    SpeechSynthesisUtterance: FakeUtterance,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent, language: "en-US", maxTouchPoints: userAgent.includes("iPhone") ? 5 : 0, audioSession },
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

  test("selects a fresh device default voice", () => {
    const engine = new FakeSynth();
    const fallback = { name: "Local English", lang: "en-US", default: false, localService: true };
    const preferred = { name: "Device Default", lang: "en-US", default: true, localService: true };
    engine.voices = [fallback, preferred];
    installBrowser(engine);
    speakText("Use my default voice.");

    const utterance = engine.utterances[0];
    expect(utterance.voice).toBe(preferred);
    expect(utterance.lang).toBe("en-US");
  });

  test("prefers a matching local voice over an iPhone default voice", () => {
    const engine = new FakeSynth();
    const remoteDefault = { name: "Enhanced Default", lang: "en-US", default: true, localService: false };
    const local = { name: "Local English", lang: "en-US", default: false, localService: true };
    engine.voices = [remoteDefault, local];
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit");

    speakText("Use an available iPhone voice.");

    expect(engine.utterances[0]?.voice).toBe(local);
  });

  test("uses the browser default path when voices are initially unavailable", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Use the implicit default voice.");

    expect(engine.utterances[0]?.voice).toBeUndefined();
    expect(engine.utterances[0]?.lang).toBeUndefined();
  });

  test("uses a newly available local voice on a later utterance", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("First sentence.");

    const localVoice = { name: "Local English", lang: "en-US", default: false, localService: true };
    engine.voices = [localVoice];
    engine.utterances[0]?.onend?.();
    speakText("Second sentence.");

    expect(engine.utterances[1]?.voice).toBe(localVoice);
    expect(engine.utterances[1]?.lang).toBe("en-US");
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
    await Bun.sleep(950);
    expect(engine.utterances).toHaveLength(2);
    await Bun.sleep(950);
    expect(engine.utterances).toHaveLength(2);
  });

  test("the unlock path never queues a silent primer", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    installSpeechUnlock();

    expect(engine.utterances).toHaveLength(0);
  });

  test("settles active iPhone speech at gesture start", () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit");

    prepareSpeechGesture();

    expect(engine.cancelCalls).toBe(1);
  });

  test("promotes the iPhone audio session and never resumes a stale queue", () => {
    const engine = new FakeSynth();
    engine.paused = true;
    const audioSession = { type: "play-and-record", state: "active" };
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", audioSession);

    prepareSpeechGesture();
    speakText("Route this through the speaker.");

    expect(audioSession.type).toBe("playback");
    expect(engine.resumeCalls).toBe(0);
  });

  test("reports speech only after the device confirms playback", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Confirm audible speech.");

    expect(isSpeaking()).toBe(false);
    engine.utterances[0]?.onstart?.();
    expect(isSpeaking()).toBe(false);
    engine.utterances[0]?.onboundary?.();
    expect(isSpeaking()).toBe(true);
    engine.utterances[0]?.onend?.();
    expect(isSpeaking()).toBe(false);
  });

  test("rejects emoji-only content", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    expect(cleanForSpeech("🐝  hello  🟢")).toBe("hello");
    expect(speakText("🐝🟢")).toBe(false);
    expect(engine.utterances).toHaveLength(0);
  });
});