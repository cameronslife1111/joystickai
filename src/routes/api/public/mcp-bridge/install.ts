import { createFileRoute } from "@tanstack/react-router";
// The helper source lives once, in bridge/orby-bridge.mjs, and is served verbatim.
import bridgeSource from "../../../../../bridge/orby-bridge.mjs?raw";

/**
 * Serves the local Orby bridge helper so a user can download and run it with
 * plain Node — no npm package publishing involved.
 */
export const Route = createFileRoute("/api/public/mcp-bridge/install")({
  server: {
    handlers: {
      GET: async () =>
        new Response(bridgeSource, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="orby-bridge.mjs"',
          },
        }),
    },
  },
});
