// Client-only fetch interceptor.
//
// Reroutes browser requests aimed at the backend host (*.supabase.co) through
// the same Lovable origin that already works on the user's network, via the
// /api/public/sb proxy route. This fixes "app loads on Wi-Fi but never loads
// data on cellular" — the carrier breaks the direct browser→backend
// connection, but the browser→Lovable-origin connection is fine.
//
// Also adds a request timeout (so a stalled request fails fast instead of
// hanging forever) and a couple of retries for transient network errors.

const BACKEND_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

// Anything at/above this body size is treated as a file upload: it gets a
// generous, size-scaled timeout and goes straight to the backend instead of
// being buffered through the same-origin proxy worker.
const LARGE_BODY_BYTES = 512 * 1024;
const UPLOAD_TIMEOUT_FLOOR_MS = 60_000;
const UPLOAD_TIMEOUT_PER_MB_MS = 30_000;
const UPLOAD_TIMEOUT_CEILING_MS = 300_000;

export const UPLOAD_TIMEOUT_REASON = "Upload timed out — check your connection and try again";
const REQUEST_TIMEOUT_REASON = "Request timed out — check your connection and try again";

function isClient() {
  return typeof window !== "undefined" && typeof window.fetch === "function";
}

// Best-effort body size. Returns null when the size can't be determined
// (streams, FormData) — FormData is treated as an upload regardless.
function bodySize(body: unknown): number | null {
  if (body == null) return 0;
  if (typeof body === "string") return body.length;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body as any)) return (body as ArrayBufferView).byteLength;
  return null;
}

function isUploadLike(body: unknown): boolean {
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  const size = bodySize(body);
  return size != null && size >= LARGE_BODY_BYTES;
}

function timeoutFor(body: unknown): number {
  if (!isUploadLike(body)) return TIMEOUT_MS;
  const size = bodySize(body) ?? 0;
  const scaled = UPLOAD_TIMEOUT_FLOOR_MS + (size / (1024 * 1024)) * UPLOAD_TIMEOUT_PER_MB_MS;
  return Math.min(UPLOAD_TIMEOUT_CEILING_MS, Math.max(UPLOAD_TIMEOUT_FLOOR_MS, scaled));
}

function rewriteUrl(rawUrl: string): string {
  if (!BACKEND_URL) return rawUrl;
  if (!rawUrl.startsWith(BACKEND_URL)) return rawUrl;
  const rest = rawUrl.slice(BACKEND_URL.replace(/\/+$/, "").length).replace(/^\/+/, "");
  return `${window.location.origin}/api/public/sb/${rest}`;
}

// Rewrite a backend media URL (storage object) to the same-origin proxy path so
// native <img>/<video>/<audio> loads travel over the connection that works on
// cellular. SSR-safe and a strict no-op for any non-backend URL.
export function proxyMediaUrl<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  if (!BACKEND_URL) return url;
  if (typeof window === "undefined") return url;
  if (!url.startsWith(BACKEND_URL)) return url;
  const rest = url.slice(BACKEND_URL.replace(/\/+$/, "").length).replace(/^\/+/, "");
  return `${window.location.origin}/api/public/sb/${rest}` as T;
}

function shouldRetry(method: string) {
  // Only auto-retry idempotent reads to avoid duplicate writes.
  return method === "GET" || method === "HEAD";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}


if (isClient() && BACKEND_URL && !(window as any).__sbProxyInstalled) {
  (window as any).__sbProxyInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;

    // Only intercept calls to the backend host.
    if (!url.startsWith(BACKEND_URL)) {
      return originalFetch(input as any, init);
    }

    const method = (init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") ?? "GET").toUpperCase();

    // When input is a Request object, fold it into init so the rewritten URL is used.
    let baseInit: RequestInit = init ?? {};
    if (typeof input !== "string" && !(input instanceof URL)) {
      const req = input as Request;
      baseInit = {
        method: req.method,
        headers: req.headers,
        body: init?.body ?? (method === "GET" || method === "HEAD" ? undefined : await req.clone().arrayBuffer()),
        credentials: req.credentials,
        ...init,
      };
    }

    // Big bodies (file uploads) go straight to the backend: buffering them
    // through the proxy worker only adds latency and memory pressure.
    const upload = isUploadLike(baseInit.body);
    const target = upload ? url : rewriteUrl(url);
    const timeoutMs = timeoutFor(baseInit.body);
    const reason = upload ? UPLOAD_TIMEOUT_REASON : REQUEST_TIMEOUT_REASON;

    const attempts = shouldRetry(method) ? MAX_RETRIES + 1 : 1;
    let lastErr: unknown;

    for (let i = 0; i < attempts; i++) {
      const controller = new AbortController();
      const externalSignal = baseInit.signal;
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      const timer = setTimeout(() => controller.abort(new DOMException(reason, "TimeoutError")), timeoutMs);
      try {
        const res = await originalFetch(target, { ...baseInit, signal: controller.signal });
        clearTimeout(timer);
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        // Don't retry if the caller aborted intentionally.
        if (externalSignal?.aborted) throw err;
        if (i < attempts - 1) await delay(300 * (i + 1));
      }
    }
    throw lastErr;

  };
}

export {};
