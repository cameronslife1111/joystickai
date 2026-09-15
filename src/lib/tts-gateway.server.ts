export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

export function buildOpenAiSpeechBody(input: { text: string; voice: string }) {
  return {
    model: OPENAI_TTS_MODEL,
    input: input.text,
    voice: input.voice,
    instructions: "Read exactly the supplied text in a natural American accent with clear, flowing sentence rhythm. Do not add or change words.",
    stream_format: "sse",
    response_format: "pcm",
  };
}

export async function streamOpenAiSpeech(
  request: Request,
  input: { text: string; voice: string },
): Promise<Response> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return Response.json(
      { message: "Speech is not configured. Add your OpenAI API key." },
      { status: 401 },
    );
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  });

  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers,
      body: JSON.stringify(buildOpenAiSpeechBody(input)),
      signal: request.signal,
    });

    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) responseHeaders.set("Retry-After", retryAfter);

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => "");
      let message = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } };
        message = parsed.message ?? parsed.error?.message ?? raw;
      } catch {}
      return Response.json(
        { message: message || `Speech request failed (${upstream.status})` },
        { status: upstream.status, headers: responseHeaders },
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return new Response(null, { status: 499 });
    }
    return Response.json(
      { message: error instanceof Error ? error.message : "Speech service unavailable" },
      { status: 502 },
    );
  }
}