import { describe, expect, test } from "bun:test";
import {
  cleanForSpeech,
  handleAppForeground,
  isSpeechEnabled,
  markPlaybackContextStale,
  recoverPlaybackContext,
  resetSpeechCaches,
  setSpeechEnabled,
  SPEECH_RATE,
  speakText,
} from "../src/lib/speech";
import { DEFAULT_TTS_VOICE, isTtsVoice, TTS_VOICES } from "../src/lib/tts-voices";

class FakePlaybackContext {
  state = "running";
  currentTime = 0;
  sampleRate = 24000;
  destination = {};
  createBuffer() {
    return { copyToChannel() {}, duration: 0 };
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect() {},
      start() {},
      stop() {},
      onended: null,
    };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

function useFakePlayback() {
  Object.assign(globalThis, {
    window: Object.assign(globalThis, { AudioContext: FakePlaybackContext }),
  });
}

describe("hosted sentence speech", () => {
  test("makes no network request while speech is disabled (Sound off)", () => {
    setSpeechEnabled(false);
    expect(isSpeechEnabled()).toBe(false);
    let fetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.reject(new Error("network must not be touched while muted"));
    }) as typeof fetch;
    try {
      expect(speakText("hello world")).toBe(false);
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("re-enabling speech lets speakText start again", () => {
    setSpeechEnabled(true);
    resetSpeechCaches();
    expect(isSpeechEnabled()).toBe(true);
    expect(speakText("hello world")).toBe(true);
  });

  test("exposes the expanded US voice library with a valid default", () => {
    expect(TTS_VOICES.length).toBeGreaterThanOrEqual(20);
    expect(TTS_VOICES.filter((v) => v.gender === "female").length).toBeGreaterThanOrEqual(10);
    expect(TTS_VOICES.filter((v) => v.gender === "male").length).toBeGreaterThanOrEqual(10);
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

  test("recreates a playback context stuck in an interrupted state", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    expect(first).not.toBeNull();
    // iOS leaves the context "interrupted" after another app uses the mic.
    first!.state = "interrupted";
    const second = await recoverPlaybackContext();
    expect(second).not.toBe(first);
    expect(second!.state).toBe("running");
  });

  test("recreates a context that refuses to resume", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    expect(first).not.toBeNull();
    first!.state = "suspended";
    first!.resume = () => Promise.resolve(); // resume() can no longer revive it
    const second = await recoverPlaybackContext();
    expect(second).not.toBe(first);
    expect(second!.state).toBe("running");
  });

  test("replaces a context whose clock is frozen while reporting running", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    expect(first!.state).toBe("running");
    const realNow = Date.now;
    let fakeNow = realNow();
    Date.now = () => fakeNow;
    try {
      await recoverPlaybackContext(); // baseline clock sample, same context
      // Wall time passes but the audio clock stays at 0 — the wedge iOS
      // leaves after another app grabs the audio route.
      fakeNow += 2_000;
      const second = await recoverPlaybackContext();
      expect(second).not.toBe(first);
      expect(second!.state).toBe("running");
    } finally {
      Date.now = realNow;
    }
  });

  test("keeps a healthy running context whose clock advances", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    const realNow = Date.now;
    let fakeNow = realNow();
    Date.now = () => fakeNow;
    try {
      await recoverPlaybackContext(); // baseline clock sample
      fakeNow += 2_000;
      first!.currentTime = 1.8; // audio clock kept ticking — engine is fine
      const second = await recoverPlaybackContext();
      expect(second).toBe(first);
    } finally {
      Date.now = realNow;
    }
  });

  test("returning to the foreground retires the context; the next speak builds a fresh one", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    handleAppForeground();
    const second = await recoverPlaybackContext();
    expect(second).not.toBe(first);
    expect(second!.state).toBe("running");
  });

  test("recreates the engine when resume() hangs after an interruption", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    first!.state = "suspended";
    first!.resume = () => new Promise<void>(() => {}); // never settles
    const second = await recoverPlaybackContext();
    expect(second).not.toBe(first);
    expect(second!.state).toBe("running");
  });

  test("discards a context marked stale (watchdog / interruption self-heal path)", async () => {
    useFakePlayback();
    resetSpeechCaches();
    const first = await recoverPlaybackContext();
    markPlaybackContextStale();
    const second = await recoverPlaybackContext();
    expect(second).not.toBe(first);
    expect(second!.state).toBe("running");
  });
});
