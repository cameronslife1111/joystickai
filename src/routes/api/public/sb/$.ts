import { createFileRoute } from "@tanstack/react-router";

// Same-origin proxy for the backend (Supabase) API.
//
// Some mobile carriers stall or break direct browser connections to the
// backend host (*.supabase.co) while the Lovable origin stays reachable.
// The browser fetch interceptor (src/lib/sb-proxy.client.ts) rewrites those
// requests to /api/public/sb/<rest>, and this handler forwards them to the
// real backend from inside the cloud network (clean connection).
//
// Security: this forwards ONLY the credentials the browser already sends
// (the user's auth token + the public key). It never uses the service-role
// key, so row-level security applies exactly as it would for a direct call.

// Hop-by-hop / unsafe headers we must not forward.
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function buildTargetUrl(request: Request, splat: string | undefined): string | null {
  const base = process.env.SUPABASE_URL;
  if (!base) return null;
  const path = (splat ?? "").replace(/^\/+/, "");
  const search = new URL(request.url).search;
  return `${base.replace(/\/+$/, "")}/${path}${search}`;
}

async function proxy(request: Request, splat: string | undefined): Promise<Response> {
  const target = buildTargetUrl(request, splat);
  if (!target) {
    return new Response("Backend not configured", { status: 500 });
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ message: "Upstream fetch failed", detail: String((err as Error)?.message ?? err) }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) respHeaders.set(key, value);
  });

  // Stream the body through instead of buffering it. This keeps large media
  // (videos, hi-res images) off the worker's memory and preserves range/partial
  // responses (206 + Content-Range) so video seeking works.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/public/sb/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
      POST: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
      PATCH: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
      PUT: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
      DELETE: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
      HEAD: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
      OPTIONS: async ({ request, params }) => proxy(request, (params as { _splat?: string })._splat),
    },
  },
});
