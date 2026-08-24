import { describe, expect, test } from "bun:test";
import { restoreDefaultAudioSession } from "../src/lib/audio-session";

function fakeNavigator(value: Record<string, unknown>) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
}

describe("iOS audio session restore", () => {
  test("restores the default auto category after recording/call mode", () => {
    const audioSession = { type: "play-and-record" };
    fakeNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)",
      maxTouchPoints: 5,
      audioSession,
    });

    expect(restoreDefaultAudioSession()).toBe(true);
    expect(audioSession.type).toBe("auto");
  });

  test("never requests ambient or playback categories", () => {
    const seen: string[] = [];
    const audioSession = {
      get type() { return seen[seen.length - 1] ?? "auto"; },
      set type(value: string) { seen.push(value); },
    };
    fakeNavigator({
      userAgent: "Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)",
      maxTouchPoints: 5,
      audioSession,
    });

    restoreDefaultAudioSession();

    expect(seen).toEqual(["auto"]);
    expect(seen).not.toContain("ambient");
    expect(seen).not.toContain("playback");
  });

  test("does nothing on non-iOS devices", () => {
    const audioSession = { type: "play-and-record" };
    fakeNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 26_5_1)",
      maxTouchPoints: 0,
      audioSession,
    });

    expect(restoreDefaultAudioSession()).toBe(false);
    expect(audioSession.type).toBe("play-and-record");
  });

  test("does nothing when the browser has no audio session API", () => {
    fakeNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)",
      maxTouchPoints: 5,
    });

    expect(restoreDefaultAudioSession()).toBe(false);
  });
});
