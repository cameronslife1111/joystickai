// Side-effect module (client only): recover from a stale cached bundle.
//
// Installed / home-screen copies of the app can keep serving an old HTML
// document that references JS chunks which no longer exist after a deploy.
// The result is either an old UI or a chunk that fails to load. When we see a
// chunk/preload failure, reload once (bypassing the HTTP cache) so the browser
// picks up the current build.

const FLAG = "orby_stale_reload_at";
const COOLDOWN_MS = 60_000;

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(FLAG) ?? 0);
    if (Date.now() - last < COOLDOWN_MS) return;
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    // Storage blocked — still attempt a single reload.
  }
  window.location.reload();
}

function looksLikeStaleChunk(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch dynamically imported module") ||
    m.includes("error loading dynamically imported module") ||
    m.includes("importing a module script failed") ||
    (m.includes("unexpected token") && m.includes("<"))
  );
}

if (typeof window !== "undefined") {
  // Vite emits this when a preloaded chunk 404s (classic stale-deploy signal).
  window.addEventListener("vite:preloadError", () => reloadOnce());

  window.addEventListener("error", (event) => {
    const msg = (event as ErrorEvent).message ?? "";
    if (msg && looksLikeStaleChunk(msg)) reloadOnce();
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? "");
    if (msg && looksLikeStaleChunk(msg)) reloadOnce();
  });
}

export {};
