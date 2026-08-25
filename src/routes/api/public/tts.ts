import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { streamGoogleSpeech } from "@/lib/tts-gateway.server";
import { TTS_VOICES } from "@/lib/tts-voices";

const voiceIds = TTS_VOICES.map((voice) => voice.id) as [string, ...string[]];
const requestSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
  voice: z.enum(voiceIds),
});

export const Route = createFileRoute("/api/public/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization");
        if (!authorization?.startsWith("Bearer ")) {
          return Response.json({ message: "Please sign in to use speech." }, { status: 401 });
        }

        const backendUrl = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!backendUrl || !publishableKey) {
          return Response.json({ message: "Authentication is not configured." }, { status: 500 });
        }

        const token = authorization.slice("Bearer ".length);
        const authClient = createClient<Database>(backendUrl, publishableKey, {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await authClient.auth.getClaims(token);
        if (error || !data.claims?.sub) {
          return Response.json({ message: "Your session expired. Please sign in again." }, { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ message: "Invalid speech request." }, { status: 400 });
        }
        const parsed = requestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ message: "Choose a valid voice and text to read." }, { status: 400 });
        }
        return streamGoogleSpeech(request, parsed.data);
      },
    },
  },
});