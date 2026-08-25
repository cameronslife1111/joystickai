import { afterEach, describe, expect, test } from "bun:test";
import { micErrorMessage, releaseMic, startPcmRecorder } from "../src/lib/audio-recorder";

class FakeTrack {
  readyState = "live";
  stopCalls = 0;
  private listeners = new Map<string, Set<() => void>>();

  stop() {
    this.stopCalls += 1;
    this.readyState = "ended";
  }

  addEventListener(type: string, handler: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: () => void) {
    this.listeners.get(type)?.delete(handler);
  }

  fire(type: string) {
    this.listeners.get(type)?.forEach((handler) => handler());
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
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
}

class HangingContext extends FakeContext {
  state = "suspended";
  resume() {
    return new Promise<void>(() => {});
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function useFakeMic(getUserMedia: () => Promise<unknown>) {
  Object.assign(globalThis, {
    window: Object.assign(globalThis, { AudioContext: FakeContext }),
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  });
}

function useFakeContext(Context: typeof FakeContext) {
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? globalThis, { AudioContext: Context }),
  });
}

afterEach(async () => {
  await releaseMic();
});

describe("audio recorder lifecycle", () => {
  test("stops a microphone stream that resolves after release", async () => {
    const pending = deferred<MediaStream>();
    const stream = new FakeStream();
    useFakeMic(() => pending.promise);

    const starting = startPcmRecorder();
    await Promise.resolve();
    await releaseMic();
    pending.resolve(stream as unknown as MediaStream);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.track.stopCalls).toBe(1);
  });

  test("release stops a warm microphone stream", async () => {
    const stream = new FakeStream();
    useFakeMic(() => Promise.resolve(stream));

    const recorder = await startPcmRecorder();
    recorder.cancel();
    expect(stream.track.stopCalls).toBe(0);

    await releaseMic();

    expect(stream.track.stopCalls).toBe(1);
  });

  test("retries once when the first microphone request is rejected", async () => {
    const stream = new FakeStream();
    let calls = 0;
    useFakeMic(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new DOMException("busy", "NotReadableError"));
      }
      return Promise.resolve(stream);
    });

    const recorder = await startPcmRecorder();
    expect(calls).toBe(2);
    recorder.cancel();
  });

  test("retries bounded transient iOS microphone startup failures", async () => {
    const stream = new FakeStream();
    let calls = 0;
    useFakeMic(() => {
      calls += 1;
      if (calls < 3) {
        return Promise.reject(new DOMException("The operation was interrupted", "AbortError"));
      }
      return Promise.resolve(stream);
    });

    const recorder = await startPcmRecorder();
    expect(calls).toBe(3);
    recorder.cancel();
  });

  test("rebuilds a recorder context when resume hangs", async () => {
    const stream = new FakeStream();
    useFakeMic(() => Promise.resolve(stream));
    globalThis.window.dispatchEvent(new Event("focus"));
    useFakeContext(HangingContext);

    await expect(startPcmRecorder()).rejects.toMatchObject({ name: "InvalidStateError" });

    useFakeContext(FakeContext);
    const recorder = await startPcmRecorder();
    recorder.cancel();
  });

  test("surfaces the real error when both microphone attempts fail", async () => {
    useFakeMic(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await expect(startPcmRecorder()).rejects.toMatchObject({ name: "NotAllowedError" });
  });

  test("a track killed by the system invalidates the warm stream", async () => {
    const first = new FakeStream();
    const second = new FakeStream();
    let calls = 0;
    useFakeMic(() => {
      calls += 1;
      return Promise.resolve(calls === 1 ? first : second);
    });

    const rec1 = await startPcmRecorder();
    rec1.cancel();
    // iOS kills the track while the app is backgrounded.
    first.track.fire("ended");

    const rec2 = await startPcmRecorder();
    expect(calls).toBe(2);
    rec2.cancel();
  });

  test("maps microphone errors to actionable messages", () => {
    expect(micErrorMessage(new DOMException("x", "NotAllowedError"))).toContain("permission");
    expect(micErrorMessage(new DOMException("x", "NotReadableError"))).toContain("busy");
    expect(
      micErrorMessage(new DOMException("Microphone request was superseded", "AbortError")),
    ).toBeNull();
    expect(micErrorMessage(new DOMException("interrupted", "AbortError"))).toContain("interrupted");
    expect(micErrorMessage(new DOMException("x", "NotSupportedError"))).toContain("not supported");
    expect(micErrorMessage(new Error("nope"))).toContain("try again");
  });
});
