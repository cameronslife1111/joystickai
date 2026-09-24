import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * Streams raw 24 kHz mono 16-bit little-endian PCM for one sentence.
 * Order: Gemini 3.8 (user's Google key) -> OpenAI gpt-4o-mini-tts (user's
 * OpenAI key). The client falls back to device speech if both fail.
 */

const VOICES = ["Charon", "Fenrir", "Puck", "Orus", "Iapetus", "Kore", "Aoede", "Leda", "Zephyr", "Autonoe"] as const;
const OPENAI_VOICE: Record<string, string> = {
  Charon: "onyx", Fenrir: "ash", Puck: "echo", Orus: "verse", Iapetus: "ballad",
  Kore: "nova", Aoede: "shimmer", Leda: "coral", Zephyr: "sage", Autonoe: "alloy",
};

async function authorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return false;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data.user;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gemini(text: string, voice: string, hq: boolean, signal: AbortSignal): Promise<Response | null> {
  const key = process.env["GOOGLE_API_KEY"];
  if (!key) return null;
  const model = hq ? "gemini-3.8-flash-tts" : "gemini-3.8-flash-lite-tts";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    },
  );
  if (!res.ok || !res.body) {
    console.error("gemini tts failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const decoder = new TextDecoder();
  let buf = "";
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const json = JSON.parse(line.slice(5).trim());
              for (const part of json?.candidates?.[0]?.content?.parts ?? []) {
                const d = part?.inlineData?.data;
                if (d) controller.enqueue(b64ToBytes(d));
              }
            } catch {}
          }
        }
      },
    }),
  );
  return new Response(body, { headers: { "content-type": "application/octet-stream", "x-tts-engine": model, "cache-control": "no-cache, no-transform" } });
}

async function openai(text: string, voice: string, signal: AbortSignal): Promise<Response | null> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", input: text, voice: OPENAI_VOICE[voice] ?? "alloy", response_format: "pcm" }),
  });
  if (!res.ok || !res.body) {
    console.error("openai tts failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  return new Response(res.body, { headers: { "content-type": "application/octet-stream", "x-tts-engine": "gpt-4o-mini-tts", "cache-control": "no-cache, no-transform" } });
}

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) return new Response("Unauthorized", { status: 401 });
        let payload: { text?: unknown; voice?: unknown; hq?: unknown };
        try { payload = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
        const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 1500) : "";
        if (!text) return new Response("Bad request", { status: 400 });
        const voice = VOICES.includes(payload.voice as never) ? (payload.voice as string) : "Kore";
        const hq = payload.hq === true;
        try {
          const r = (await gemini(text, voice, hq, request.signal)) ?? (await openai(text, voice, request.signal));
          return r ?? new Response("Speech unavailable", { status: 502 });
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return new Response(null, { status: 499 });
          console.error("tts error", e);
          try {
            const r = await openai(text, voice, request.signal);
            if (r) return r;
          } catch {}
          return new Response("Speech unavailable", { status: 502 });
        }
      },
    },
  },
});
