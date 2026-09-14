import { describe, expect, it } from "vitest";
import {
  MAX_CHUNK_SECONDS,
  extensionFor,
  parseWav,
  splitWavChunks,
  transcriptionErrorMessage,
  transcribeRecording,
} from "@/lib/whisper.functions";

const RATE = 16000;

function makeWav(seconds: number): Uint8Array {
  const samples = Math.floor(RATE * seconds);
  const out = new Uint8Array(44 + samples * 2);
  const view = new DataView(out.buffer);
  const put = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  put(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples * 2, true);
  return out;
}

function jsonResponse(text: string) {
  return new Response(JSON.stringify({ text }), { status: 200 });
}

describe("wav handling", () => {
  it("parses a 16 kHz mono wav header", () => {
    const info = parseWav(makeWav(1));
    expect(info?.sampleRate).toBe(RATE);
    expect(info?.channels).toBe(1);
    expect(info?.dataLength).toBe(RATE * 2);
  });

  it("keeps short recordings as one piece", () => {
    expect(splitWavChunks(makeWav(30))).toHaveLength(1);
  });

  it("splits over-long recordings into complete wav chunks", () => {
    const chunks = splitWavChunks(makeWav(MAX_CHUNK_SECONDS * 2 + 10));
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) expect(parseWav(chunk)).not.toBeNull();
  });

  it("passes non-wav audio through untouched", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(splitWavChunks(bytes)).toEqual([bytes]);
  });

  it("names the upload for its real container", () => {
    expect(extensionFor("audio/wav")).toBe("wav");
    expect(extensionFor("audio/mp4;codecs=mp4a")).toBe("mp4");
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
  });
});

describe("error messages", () => {
  it("explains a rejected key", () => {
    expect(transcriptionErrorMessage(401, "")).toMatch(/key was rejected/i);
  });
  it("explains an out-of-credit account", () => {
    expect(transcriptionErrorMessage(429, JSON.stringify({ error: { message: "insufficient_quota" } }))).toMatch(
      /out of credit/i,
    );
  });
  it("explains rate limiting", () => {
    expect(transcriptionErrorMessage(429, "slow down")).toMatch(/too many/i);
  });
  it("explains server hiccups", () => {
    expect(transcriptionErrorMessage(503, "")).toMatch(/hiccup/i);
  });
});

describe("transcribeRecording", () => {
  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response("boom", { status: 500 });
      return jsonResponse("hello there");
    }) as unknown as typeof fetch;
    const res = await transcribeRecording("key", makeWav(2), "audio/wav", fetchImpl);
    expect(res.text).toBe("hello there");
    expect(calls).toBe(2);
  });

  it("returns the text from the good chunks when one chunk fails", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      // First chunk fails every attempt; later chunks succeed.
      if (calls <= 3) return new Response("boom", { status: 500 });
      return jsonResponse("second part");
    }) as unknown as typeof fetch;
    const res = await transcribeRecording("key", makeWav(MAX_CHUNK_SECONDS + 5), "audio/wav", fetchImpl);
    expect(res.text).toContain("second part");
    expect(res.text).toMatch(/couldn't be transcribed/i);
  });

  it("surfaces a credit problem immediately without retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), { status: 402 });
    }) as unknown as typeof fetch;
    await expect(transcribeRecording("key", makeWav(2), "audio/wav", fetchImpl)).rejects.toThrow(/out of credit/i);
    expect(calls).toBe(1);
  });

  it("fails clearly when nothing could be transcribed", async () => {
    const fetchImpl = (async () => jsonResponse("")) as unknown as typeof fetch;
    await expect(transcribeRecording("key", makeWav(2), "audio/wav", fetchImpl)).rejects.toThrow(
      /Nothing could be transcribed/i,
    );
  });
});
