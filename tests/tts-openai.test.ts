import { describe, expect, test } from "bun:test";
import { buildOpenAiSpeechBody, OPENAI_TTS_MODEL } from "../src/lib/tts-gateway.server";

describe("OpenAI sentence speech", () => {
  test("requests streaming 24 kHz PCM-compatible speech", () => {
    expect(buildOpenAiSpeechBody({ text: "Read this.", voice: "coral" })).toEqual({
      model: OPENAI_TTS_MODEL,
      input: "Read this.",
      voice: "coral",
      instructions: expect.stringContaining("exactly"),
      stream_format: "sse",
      response_format: "pcm",
    });
  });
});