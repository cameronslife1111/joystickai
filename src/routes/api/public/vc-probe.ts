// Temporary diagnostic: inspect Browser Use API shapes. Secret-guarded.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/vc-probe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-plan-tick-secret") !== process.env["PLAN_TICK_SECRET"])
          return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => ({}))) as any;
        const path = String(body.path ?? "");
        const res = await fetch(`https://api.browser-use.com/api/v4${path}`, {
          method: String(body.method ?? "GET"),
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Use-API-Key": process.env["BROWSER_USE_API_KEY"]!,
          },
          ...(body.body ? { body: JSON.stringify(body.body) } : {}),
        });
        const text = await res.text();
        return Response.json({ status: res.status, body: text.slice(0, 3000) });
      },
    },
  },
});
