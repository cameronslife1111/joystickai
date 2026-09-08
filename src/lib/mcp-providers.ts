/**
 * Registry of external creative apps Orby can drive through a local MCP server.
 *
 * Everything provider-specific lives here. The chat toggle, the connection
 * status pill, the setup card and the planner tool are all generic — adding
 * Photoshop, Blender or VS Code later means adding one entry to this file.
 */

export type McpProviderId = "davinci_resolve";

/** Where the bridge helper is downloaded from (falls back to the published app). */
export const PUBLISHED_ORIGIN = "https://orbyai.lovable.app";

export function bridgeOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return PUBLISHED_ORIGIN;
}

export type McpProvider = {
  id: McpProviderId;
  /** Chat capability key that switches this provider on. */
  capability: "davinci_resolve";
  name: string;
  emoji: string;
  /** One line shown under the toggle. */
  hint: string;
  /** What the user must have running locally. */
  requirement: string;
  /** Settings the user should check inside the app itself. */
  checklist: string[];
  /** Numbered setup steps shown in the connection card. */
  steps: { title: string; body: string }[];
  /** Common failures and what to do about them. */
  troubleshooting: { problem: string; fix: string }[];
  /** Copy/paste command for the one-time setup. */
  installCommand: (code: string) => string;
  /** A short, curated menu of tools so the planner isn't shown 300 of them. */
  tools: { name: string; description: string }[];
};

export const MCP_PROVIDERS: Record<McpProviderId, McpProvider> = {
  davinci_resolve: {
    id: "davinci_resolve",
    capability: "davinci_resolve",
    name: "DaVinci Resolve",
    emoji: "🎬",
    hint: "Edit, grade and export in DaVinci Resolve",
    requirement:
      "This runs on your own computer, so it needs a one-time setup in a terminal window. It takes about two minutes.",
    checklist: [
      "You're using DaVinci Resolve Studio (the paid version) — the free version blocks outside control.",
      "Resolve is open, with a project open rather than the Project Manager screen.",
      "In Resolve: Preferences → System → General → External scripting using = Local. Nothing else on that page needs changing.",
      "On a Mac, allow the permission prompt if it asks whether Terminal can control other apps.",
    ],
    steps: [
      {
        title: "Install Node.js (once)",
        body: "In a terminal, type node -v. If you see a version number, skip this. If it says command not found, download the LTS installer from nodejs.org, run it, then close and reopen the terminal.",
      },
      {
        title: "Open DaVinci Resolve Studio",
        body: "Open Resolve and open a project. Check the settings list below.",
      },
      {
        title: "Run this one line in a terminal",
        body: "Copy the command, paste it into Terminal, and press Return. Leave that window open while you use Orby — it's the link between Orby and Resolve.",
      },
      {
        title: "Come back here",
        body: "This card turns green by itself and shows your Resolve version and project. Then just talk normally in chat.",
      },
    ],
    troubleshooting: [
      {
        problem: "command not found: node",
        fix: "Node.js isn't installed yet, or the terminal was open before you installed it. Install it from nodejs.org, then open a fresh terminal window.",
      },
      {
        problem: "404 Not Found from npm",
        fix: "That was an older command. Use the one shown above — it downloads the helper straight from Orby, with nothing coming from npm.",
      },
      {
        problem: "Couldn't reach DaVinci Resolve",
        fix: "Resolve Studio must be open with a project open, and External scripting using must be set to Local.",
      },
    ],
    installCommand: (code: string) =>
      `curl -fsSL ${bridgeOrigin()}/api/public/mcp-bridge/install -o ~/orby-bridge.mjs && node ~/orby-bridge.mjs connect ${code}`,
    tools: RESOLVE_TOOLS,
  },
};



export const MCP_PROVIDER_LIST = Object.values(MCP_PROVIDERS);

export function providerForCapability(capability: string): McpProvider | undefined {
  return MCP_PROVIDER_LIST.find((p) => p.capability === capability);
}

export type McpConnectionStatus = {
  provider: McpProviderId;
  status: "none" | "pending" | "connected" | "offline";
  pairingCode: string | null;
  /** When the pairing code stops working; null when there is no live code. */
  pairingExpiresAt: string | null;
  lastSeenAt: string | null;
  /** Flattened to strings so it crosses the server-function boundary cleanly. */
  serverInfo: Record<string, string> | null;

};
