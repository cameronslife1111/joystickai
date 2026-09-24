import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/** Streams raw 24 kHz mono 16-bit PCM from Gemini 3.8 Flash-Lite. No fallbacks. */

const MODEL = "gemini-3.8-flash-lite-tts";
const VOICES = ["Charon", "Fenrir", "Puck", "Orus", "Iapetus", "Kore", "Aoede", "Leda", "Zephyr", "Autonoe"] as const;

let sbClient: ReturnType<typeof createClient> | null = null;
async function authorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return false;
  sbClient ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // getClaims verifies the JWT locally against cached signing keys (no round trip).
  const { data, error } = await sbClient.auth.getClaims(token);
  return !error && !!data?.claims?.sub;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: { text?: unknown; voice?: unknown };
        try { payload = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
        const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 1500) : "";
        if (!text) return new Response("Bad request", { status: 400 });
        const voice = VOICES.includes(payload.voice as never) ? (payload.voice as string) : "Kore";
        const googleKey = process.env["GOOGLE_API_KEY"];
        if (!googleKey) return new Response("Speech error", { status: 500 });

        try {
          // Auth and Gemini start in parallel; audio is only sent if auth passes.
          const authP = authorized(request);
          const resP = fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
            {
              method: "POST",
              signal: request.signal,
              headers: { "content-type": "application/json", "x-goog-api-key": googleKey },
              body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                },
              }),
            },
          );
          if (!(await authP)) {
            resP.then((r) => r.body?.cancel()).catch(() => {});
            return new Response("Unauthorized", { status: 401 });
          }
          const res = await resP;
          if (!res.ok || !res.body) {
            console.error("gemini tts failed", res.status, await res.text().catch(() => ""));
            return new Response("Speech error", { status: res.status || 502 });
          }
          const decoder = new TextDecoder();
          let buf = "";
          const handleFrame = (frame: string, controller: TransformStreamDefaultController<Uint8Array>) => {
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
          };
          const body = res.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
                let idx: number;
                while ((idx = buf.indexOf("\n\n")) >= 0) {
                  handleFrame(buf.slice(0, idx), controller);
                  buf = buf.slice(idx + 2);
                }
              },
              flush(controller) { if (buf.trim()) handleFrame(buf, controller); },
            }),
          );
          return new Response(body, {
            headers: { "content-type": "application/octet-stream", "cache-control": "no-cache, no-transform" },
          });
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return new Response(null, { status: 499 });
          console.error("tts error", e);
          return new Response("Speech error", { status: 502 });
        }
      },
    },
  },
});
