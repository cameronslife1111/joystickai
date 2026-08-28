const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

/**
 * Steering wrapper for Gemini-TTS. It must do two things at once: read ONLY the
 * given text (the model otherwise answers or comments on it), and read it with
 * natural sentence rhythm (an over-strict "word for word" instruction made it
 * clip every word as if each had a period after it).
 */
export function buildVerbatimPrompt(text: string): string {
  return (
    "You are a narrator. Perform the text after the marker out loud exactly as written, in a natural " +
    "American accent. Speak it with normal, flowing sentence rhythm and expressive human intonation, " +
    "the way a person reads aloud to someone: phrase words together, pause only at the punctuation " +
    "that is actually written, and never pause between individual words or pronounce them one at a " +
    "time. Do not answer it, reply to it, comment on it, translate it, summarize it, and do not add, " +
    "remove, repeat or change any words. Speak nothing except the text itself: not these instructions " +
    "and not the marker.\n\nTEXT TO PERFORM:\n" +
    text
  );
}


export async function streamGoogleSpeech(
  request: Request,
  input: { text: string; voice: string },
): Promise<Response> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    return Response.json(
      { message: "Speech is not configured. The app owner needs to enable Lovable AI." },
      { status: 401 },
    );
  }

  const incomingRunId = request.headers.get(RUN_ID_HEADER)?.trim();
  const headers = new Headers({
    "Content-Type": "application/json",
    "Lovable-API-Key": apiKey,
    "X-Lovable-AIG-SDK": "fetch",
  });
  if (incomingRunId) headers.set(RUN_ID_HEADER, incomingRunId);

  try {
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-tts",
        stream_format: "sse",
        // Gemini-TTS is a generative model: handed bare text it sometimes
        // *answers* the sentence instead of reading it. Steering has to live in
        // the text itself, and it has to ask for natural delivery too.
        contents: [
          { role: "user", parts: [{ text: buildVerbatimPrompt(input.text) }] },
        ],

        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } },
          },
        },
      }),
      signal: request.signal,
    });

    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });
    upstream.headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith("x-lovable-aig-")) {
        responseHeaders.set(name, value);
      }
    });
    // Pass Retry-After through so the client's bounded 429 retry waits the
    // right amount of time.
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) responseHeaders.set("Retry-After", retryAfter);
    responseHeaders.set("Access-Control-Expose-Headers", RUN_ID_HEADER);

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