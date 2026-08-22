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

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  loop = false;
  preload = "";
  volume = 1;
  muted = false;
  ended = false;
  paused = true;
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;

  constructor() {
    FakeAudio.instances.push(this);
  }

  setAttribute() {}
  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls += 1;
    this.paused = true;
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
      createElement: (tag: string) => tag === "audio" ? new FakeAudio() : {},
    },
    SpeechSynthesisUtterance: FakeUtterance,
    Blob,
  });
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: { createObjectURL: () => "blob:route-anchor" },
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

  test("lets iPhone use its implicit system voice first", () => {
    const engine = new FakeSynth();
    const remoteDefault = { name: "Enhanced Default", lang: "en-US", default: true, localService: false };
    const local = { name: "Local English", lang: "en-US", default: false, localService: true };
    engine.voices = [remoteDefault, local];
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit");

    speakText("Use an available iPhone voice.");

    expect(engine.utterances[0]?.voice).toBeUndefined();
    expect(engine.utterances[0]?.lang).toBeUndefined();
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

  test("iPhone replaces active speech in the same tick as the swipe", () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });

    speakText("Newest sentence.");

    expect(engine.cancelCalls).toBe(1);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Newest sentence."]);
  });

  test("speaks a long sentence as a single utterance", () => {
    const engine = new FakeSynth();
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });
    const long = `${"word ".repeat(60)}end.`.trim();

    speakText(long);

    expect(engine.utterances).toHaveLength(1);
    expect(engine.utterances[0]?.text).toBe(long);
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
    await Bun.sleep(400);
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

  test("gesture start only opens the route, it never cancels speech", () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });

    prepareSpeechGesture();

    expect(engine.cancelCalls).toBe(0);
    expect(FakeAudio.instances.at(-1)?.playCalls).toBe(1);
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
    expect(FakeAudio.instances.at(-1)?.playCalls).toBeGreaterThan(0);
  });

  test("keeps one iPhone route anchor running across sentences", () => {
    const engine = new FakeSynth();
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });

    prepareSpeechGesture();
    speakText("Keep this on the speaker.");
    const anchor = FakeAudio.instances.at(-1);
    expect(anchor?.paused).toBe(false);
    expect(anchor?.playCalls).toBe(1);

    engine.utterances[0]?.onend?.();
    expect(anchor?.paused).toBe(false);

    prepareSpeechGesture();
    speakText("And this one too.");
    expect(anchor?.playCalls).toBe(1);
    expect(anchor?.paused).toBe(false);
  });

  test("retries an errored implicit iPhone voice with a local voice", async () => {
    const engine = new FakeSynth();
    const local = { name: "Local English", lang: "en-US", default: false, localService: true };
    engine.voices = [local];
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });

    speakText("Retry locally.");
    expect(engine.utterances[0]?.voice).toBeUndefined();
    engine.utterances[0]?.onerror?.({ error: "synthesis-failed" });
    await Bun.sleep(35);
    expect(engine.utterances[1]?.voice).toBe(local);
  });

  test("reports speech only after the device confirms playback", () => {
    const engine = new FakeSynth();
    installBrowser(engine);
    speakText("Confirm audible speech.");

    expect(isSpeaking()).toBe(false);
    engine.utterances[0]?.onstart?.();
    expect(isSpeaking()).toBe(true);
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

  test("iPhone hits a stubborn engine again so no tail is left playing", () => {
    const engine = new FakeSynth();
    engine.speaking = true;
    let ignoreFirst = true;
    engine.cancel = function () {
      this.cancelCalls += 1;
      if (ignoreFirst) { ignoreFirst = false; return; }
      this.speaking = false;
      this.pending = false;
    };
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });

    speakText("Newest sentence.");

    expect(engine.cancelCalls).toBe(2);
    expect(engine.utterances.map((item) => item.text)).toEqual(["Newest sentence."]);
  });

  test("a replaced utterance can no longer report state", () => {
    const engine = new FakeSynth();
    installBrowser(engine, "Mozilla/5.0 (iPhone) AppleWebKit", { type: "auto" });
    speakText("Older sentence.");
    const stale = engine.utterances[0]!;
    engine.speaking = true;

    speakText("Newest sentence.");
    expect(stale.onend).toBeNull();
    expect(stale.onstart).toBeNull();
    engine.utterances[1]?.onstart?.();
    expect(isSpeaking()).toBe(true);
  });
});
