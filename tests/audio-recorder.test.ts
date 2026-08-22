import { afterEach, describe, expect, test } from "bun:test";
import { releaseMic, startPcmRecorder } from "../src/lib/audio-recorder";

class FakeTrack {
  readyState = "live";
  stopCalls = 0;

  stop() {
    this.stopCalls += 1;
    this.readyState = "ended";
  }
}

class FakeStream {
  track = new FakeTrack();
  getTracks() { return [this.track]; }
  getAudioTracks() { return [this.track]; }
}

class FakeSource {
  connect() {}
  disconnect() {}
}

class FakeContext {
  state = "running";
  sampleRate = 48000;
  destination = {};
  createMediaStreamSource() { return new FakeSource(); }
  createScriptProcessor() {
    return { onaudioprocess: null, connect() {}, disconnect() {} };
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  resume() { return Promise.resolve(); }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(async () => {
  await releaseMic();
});

describe("audio recorder routing", () => {
  test("stops a microphone stream that resolves after release", async () => {
    const pending = deferred<MediaStream>();
    const stream = new FakeStream();
    Object.assign(globalThis, {
      window: Object.assign(globalThis, { AudioContext: FakeContext }),
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (iPhone) AppleWebKit",
        mediaDevices: { getUserMedia: () => pending.promise },
        audioSession: { type: "play-and-record" },
      },
    });

    const starting = startPcmRecorder();
    await Promise.resolve();
    await releaseMic();
    pending.resolve(stream as unknown as MediaStream);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.track.stopCalls).toBe(1);
    expect(navigator.audioSession.type).toBe("playback");
  });
});