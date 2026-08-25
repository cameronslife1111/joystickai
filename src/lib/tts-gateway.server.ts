const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

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
        contents: [{ role: "user", parts: [{ text: input.text }] }],
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