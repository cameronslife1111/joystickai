import { beforeEach, describe, expect, test } from "bun:test";
import {
  cancelSpeech,
  cleanForSpeech,
  handleAppForeground,
  isSpeaking,
  isSpeechEnabled,
  isSpeechSuppressed,
  resetSpeechCaches,
  setSpeechEnabled,
  setSpeechSuppressed,
  SPEECH_RATE,
  speakText,
} from "../src/lib/speech";

type FakeUtterance = {
  text: string;
  rate: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

class FakeSpeechSynthesisUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  lang = "";
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

type FakeSynth = {
  spoken: FakeUtterance[];
  cancels: number;
  speaking: boolean;
  pending: boolean;
  paused: boolean;
  speak: (u: FakeUtterance) => void;
  cancel: () => void;
  resume: () => void;
  getVoices: () => unknown[];
  addEventListener: () => void;
};

type FakeAudioSession = {
  type: string;
  state: string;
  requestedTypes: string[];
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  interrupt: () => void;
};

function installFakeAudioSession(): FakeAudioSession {
  const listeners = new Set<() => void>();
  let currentType = "ambient";
  const session: FakeAudioSession = {
    state: "active",
    requestedTypes: [],
    get type() { return currentType; },
    set type(value: string) {
      session.requestedTypes.push(value);
      currentType = value;
    },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    interrupt() {
      session.state = "interrupted";
      listeners.forEach((listener) => listener());
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)",
      maxTouchPoints: 5,
      language: "en-US",
      audioSession: session,
    },
  });
  return session;
}

function installFakeSynth(voices: unknown[] = []): FakeSynth {
  const synth: FakeSynth = {
    spoken: [],
    cancels: 0,
    speaking: false,
    pending: false,
    paused: false,
    speak(utterance) {
      synth.spoken.push(utterance);
      synth.speaking = true;
    },
    cancel() {
      synth.cancels += 1;
      synth.speaking = false;
    },
    resume() {},
    getVoices: () => voices,
    addEventListener: () => {},
  };
  const win = globalThis as unknown as Record<string, unknown>;
  win["speechSynthesis"] = synth;
  win["SpeechSynthesisUtterance"] = FakeSpeechSynthesisUtterance;
  win["window"] = globalThis;
  if (typeof (globalThis as any).addEventListener !== "function") {
    (globalThis as any).addEventListener = () => {};
  }
  return synth;
}

function removeSynth() {
  const win = globalThis as unknown as Record<string, unknown>;
  win["window"] = globalThis;
  delete win["speechSynthesis"];
}

describe("device sentence speech", () => {
  beforeEach(() => {
    resetSpeechCaches();
    setSpeechSuppressed(false);
    setSpeechEnabled(false);
  });

  test("says nothing and touches no network while Sound is off", () => {
    const synth = installFakeSynth();
    let fetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.reject(new Error("device speech must never use the network"));
    }) as typeof fetch;
    try {
      expect(isSpeechEnabled()).toBe(false);
      expect(speakText("hello world")).toBe(false);
      expect(synth.spoken.length).toBe(0);
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("speaks exactly one utterance with the normal device-default rate and the device default voice", () => {
    const synth = installFakeSynth();
    setSpeechEnabled(true);
    let fetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.reject(new Error("device speech must never use the network"));
    }) as typeof fetch;
    try {
      expect(speakText("Water the roses.")).toBe(true);
      expect(synth.spoken.length).toBe(1);
      expect(synth.spoken[0]!.text).toBe("Water the roses.");
      expect(synth.spoken[0]!.rate).toBe(SPEECH_RATE);
      // No explicit voice: whatever the user picked on their device is used.
      expect(synth.spoken[0]!.voice).toBe(null);
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      cancelSpeech();
    }
  });

  test("asks for short-speech ducking, restores ambient, and creates no audio element", () => {
    const synth = installFakeSynth();
    const session = installFakeAudioSession();
    const win = globalThis as unknown as Record<string, unknown>;
    const originalAudio = win["Audio"];
    let audioElements = 0;
    win["Audio"] = class { constructor() { audioElements += 1; } };
    try {
      setSpeechEnabled(true);
      expect(speakText("Mix this over music.")).toBe(true);
      synth.spoken[0]!.onstart?.();
      synth.spoken[0]!.onend?.();
      expect(session.requestedTypes).toContain("transient");
      expect(session.requestedTypes).not.toContain("playback");
      expect(session.requestedTypes).not.toContain("transient-solo");
      expect(session.type).toBe("ambient");
      expect(audioElements).toBe(0);
    } finally {
      if (originalAudio === undefined) delete win["Audio"];
      else win["Audio"] = originalAudio;
      cancelSpeech();
    }
  });


  test("a new sentence cancels the old one, then speaks the newest", () => {
    const synth = installFakeSynth();
    setSpeechEnabled(true);
    speakText("first sentence");
    const cancelsAfterFirst = synth.cancels;
    speakText("second sentence");
    expect(synth.cancels).toBeGreaterThan(cancelsAfterFirst);
    expect(synth.spoken.length).toBe(2);
    expect(synth.spoken[1]!.text).toBe("second sentence");
    cancelSpeech();
  });

  test("speaking state follows the utterance lifecycle", () => {
    const synth = installFakeSynth();
    setSpeechEnabled(true);
    let ended = false;
    speakText("a spoken sentence", { onEnd: () => { ended = true; } });
    const utterance = synth.spoken[0]!;
    utterance.onstart?.();
    expect(isSpeaking()).toBe(true);
    utterance.onend?.();
    expect(isSpeaking()).toBe(false);
    expect(ended).toBe(true);
  });

  test("stays silent while a hands-free call is live", () => {
    const synth = installFakeSynth();
    setSpeechEnabled(true);
    setSpeechSuppressed(true);
    expect(isSpeechSuppressed()).toBe(true);
    expect(speakText("during a call")).toBe(false);
    expect(synth.spoken.length).toBe(0);
    setSpeechSuppressed(false);
  });

  test("retries once with an explicit local voice when the default errors", () => {
    const localVoice = { name: "Samantha", lang: "en-US", localService: true, default: true };
    const synth = installFakeSynth([localVoice]);
    setSpeechEnabled(true);
    speakText("retry me");
    synth.spoken[0]!.onerror?.();
    expect(synth.spoken.length).toBe(2);
    expect(synth.spoken[1]!.voice).toBe(localVoice);
    cancelSpeech();
  });

  test("rejects blank and emoji-only content before speaking", () => {
    const synth = installFakeSynth();
    setSpeechEnabled(true);
    expect(speakText("   ")).toBe(false);
    expect(speakText("🐝🟢")).toBe(false);
    expect(synth.spoken.length).toBe(0);
  });

  test("removes emoji and normalizes whitespace without dropping latin letters", () => {
    expect(cleanForSpeech("🐝  hello   world  🟢")).toBe("hello world");
    expect(cleanForSpeech("þetta reddast")).toBe("þetta reddast");
  });

  test("returning to the foreground clears speech state without throwing", () => {
    installFakeSynth();
    setSpeechEnabled(true);
    speakText("before backgrounding");
    expect(() => handleAppForeground()).not.toThrow();
    expect(isSpeaking()).toBe(false);
  });

  test("re-arms short-speech mode after an iOS audio interruption", () => {
    const synth = installFakeSynth();
    const session = installFakeAudioSession();
    setSpeechEnabled(true);
    speakText("before interruption");
    synth.spoken[0]!.onstart?.();

    session.interrupt();
    session.state = "active";
    session.requestedTypes.length = 0;
    expect(speakText("after interruption")).toBe(true);
    expect(session.requestedTypes).toContain("transient");
    expect(session.requestedTypes).not.toContain("playback");
    expect(session.requestedTypes).not.toContain("transient-solo");
    expect(synth.spoken.at(-1)?.text).toBe("after interruption");
    cancelSpeech();
  });


  test("bails cleanly on a device with no speech support", () => {
    removeSynth();
    setSpeechEnabled(true);
    let errored = false;
    expect(speakText("nothing to speak with", { onError: () => { errored = true; } })).toBe(false);
    expect(errored).toBe(true);
  });
});
