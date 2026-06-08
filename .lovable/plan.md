# Fix: App won't load on cellular networks

## What's actually happening

Your phone can reach the **Lovable origin** (the app shell HTML/JS loads fine on cellular — that's why you see the orb and the menu). But the browser's direct requests to the **backend host** (`*.supabase.co`) stall on your mobile carrier and never complete.

Two things combine to make it look "stuck forever":

1. The login check reads the saved session from local storage **without a network call**, so you get into the app even though the backend is unreachable — that's why you're not bounced to the login page.
2. Every data request (your list title, sentences, preferences) talks to the backend host **directly from the browser**, with **no timeout, no retry, and no error message**. When those stall on cellular, the app just sits on "—" and "Hold the orb…" indefinitely.

So the carrier is choking the browser→backend connection specifically, while the browser→Lovable connection works.

## The fix (definitive + resilient)

Route backend requests through the **same Lovable origin that already works on your carrier**, instead of letting the browser hit the backend host directly. The Lovable server then forwards them to the backend from inside the cloud network (which always has a clean connection). On top of that, add timeouts, retries, and a real error/retry screen so the app can never silently hang.

### 1. Same-origin backend proxy (the core fix)

Add a catch-all server route `src/routes/api/public/sb/$.ts` that forwards any request to the real backend:

- Accepts `GET / POST / PATCH / DELETE / HEAD / OPTIONS`.
- Forwards the path + query string to `${SUPABASE_URL}/<rest>` (e.g. `/api/public/sb/rest/v1/documents?...` → backend `/rest/v1/documents?...`).
- Passes through the caller's own headers (`apikey`, `authorization`, `content-type`, `prefer`, `range`, etc.) and body unchanged.
- Returns the upstream status, body, and key response headers (`content-type`, `content-range` for pagination).

Security: the proxy **only forwards the credentials the browser already sends** (your normal logged-in token + the public key). It does **not** use the service-role key, so row-level security still applies exactly as today — no new access is granted. It only forwards to the one configured backend host.

### 2. Client request redirector

Add `src/lib/sb-proxy.client.ts`, imported once (for its side effect) at the top of `src/routes/__root.tsx`. On the client it wraps the browser's `fetch` so that any request aimed at the backend host is rewritten to go through `/api/public/sb/...` on the current origin instead. It also:

- Adds a **20s timeout** (via `AbortController`) so a stalled request fails fast instead of hanging forever.
- **Retries** transient network failures a couple of times with a short backoff.

This automatically covers data reads, writes, token refresh, and storage — without touching the auto-generated backend client file.

### 3. Query resilience

In `src/router.tsx`, give the data layer sane defaults: retry failed requests with exponential backoff, automatically refetch when the connection comes back (`refetchOnReconnect`), and keep retrying even if the browser briefly reports "offline." This means once your signal stabilizes, the app self-heals instead of staying blank.

### 4. Never-blank fallback UI

On the main app screen (`src/routes/_authenticated/app.tsx`), when the documents request errors out, show a small **"Couldn't reach the server — Retry"** message with a button instead of the permanent empty shell, so you always have a way to recover and can tell loading from failure.

## Notes / limits

- Live realtime updates run over a websocket, which this proxy doesn't cover; if any realtime feature also struggles on cellular we can address it separately. All normal loading, saving, and AI calls are covered.
- No database or schema changes. The auto-generated backend client file is left untouched.

## How we'll verify

- Confirm the app builds and still loads normally on Wi-Fi (data flows through the new proxy path).
- Confirm requests in the network panel now go to `/api/public/sb/...` on the app's own domain rather than directly to the backend host.
- You then re-test on cellular — it should load the same as Wi-Fi.
