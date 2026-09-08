import { createFileRoute } from "@tanstack/react-router";

/**
 * Watchdog for queued chat turns. Finishes any turn whose client went away
 * mid-flight (phone locked, app switched, tab discarded) so a sent message
 * always gets its reply. Safe to call from a scheduler or from the app when it
 * returns to the foreground: claiming is guarded, so nothing runs twice.
 */
async function tick() {
  const { runStaleChatTurns } = await import("@/lib/chat-turn.server");
  const results = await runStaleChatTurns(5);
  return Response.json({ ok: true, ran: results.length, results });
}

export const Route = createFileRoute("/api/public/chat-turn-tick")({
  server: {
    handlers: {
      GET: async () => await tick(),
      POST: async () => await tick(),
    },
  },
});
