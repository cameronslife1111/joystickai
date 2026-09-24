/// <reference lib="webworker" />
// On-device voice engine. Runs the free Kokoro model inside the browser so the
// sentence becomes real audio on the phone — no network per sentence.
import { KokoroTTS } from "kokoro-js";

type Req = { type: "load" } | { type: "gen"; id: number; text: string; voice: string; speed: number };

let ttsPromise: Promise<KokoroTTS> | null = null;

function load() {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "wasm",
    }).catch((e) => {
      ttsPromise = null;
      throw e;
    });
  }
  return ttsPromise;
}

self.onmessage = async (event: MessageEvent<Req>) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      await load();
      (self as unknown as Worker).postMessage({ type: "ready" });
      return;
    }
    const tts = await load();
    const audio = await tts.generate(msg.text, { voice: msg.voice as never, speed: msg.speed });
    const pcm = audio.audio as Float32Array;
    (self as unknown as Worker).postMessage(
      { type: "audio", id: msg.id, pcm, rate: audio.sampling_rate },
      [pcm.buffer],
    );
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: msg.type === "load" ? "load-failed" : "error",
      id: (msg as { id?: number }).id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
