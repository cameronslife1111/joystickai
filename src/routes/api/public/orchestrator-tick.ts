import { createFileRoute } from "@tanstack/react-router";

/**
 * Standing autopilot for the Orchestrator chat. Drains each user's approved
 * proposals one plan at a time and drafts fresh proposals from their focus
 * documents. Safe to call repeatedly: promotion only starts a plan when nothing
 * else is running, and drafting is rate-limited per user.
 */
async function tick() {
  const { runOrchestratorTick } = await import("@/lib/orchestrator.server");
  const results = await runOrchestratorTick(20);
  return Response.json({ ok: true, ran: results.length, results });
}

export const Route = createFileRoute("/api/public/orchestrator-tick")({
  server: {
    handlers: {
      GET: async () => await tick(),
      POST: async () => await tick(),
    },
  },
});
