/**
 * Registry of external creative apps Orby can drive through a local MCP server.
 *
 * Everything provider-specific lives here. The chat toggle, the connection
 * status pill, the setup card and the planner tool are all generic — adding
 * Photoshop, Blender or VS Code later means adding one entry to this file.
 */

export type McpProviderId = "davinci_resolve";

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
  /** The MCP server the local bridge launches. */
  serverPackage: string;
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
      "DaVinci Resolve Studio must be open on your computer, with external scripting set to Local in Preferences → System → General.",
    serverPackage: "resolve-mcp",
    installCommand: (code: string) => `npx orby-bridge connect ${code}`,
    tools: [
      { name: "get_project_info", description: "Current project, timeline, frame rate and resolution" },
      { name: "list_timelines", description: "List the timelines in the current project" },
      { name: "create_timeline", description: "Create a new timeline (name, resolution, frame rate)" },
      { name: "set_current_timeline", description: "Switch to a timeline by name" },
      { name: "list_media_pool_clips", description: "List clips in the media pool" },
      { name: "import_media", description: "Import files from disk into the media pool" },
      { name: "append_clip_to_timeline", description: "Append a media pool clip to the current timeline" },
      { name: "add_transition", description: "Add a transition between two clips" },
      { name: "add_fusion_effect", description: "Add a Fusion effect to a clip (delta keyer for green screen, etc.)" },
      { name: "set_clip_property", description: "Set a clip property (scale, position, retime, opacity)" },
      { name: "apply_lut", description: "Apply a LUT or colour preset to a clip" },
      { name: "grade_clip", description: "Adjust lift/gamma/gain/saturation on a clip" },
      { name: "add_text_plus", description: "Add a Text+ title to the timeline" },
      { name: "render_timeline", description: "Render/export the timeline with a preset (e.g. vertical 9:16 short)" },
      { name: "get_render_status", description: "Check whether a render job has finished" },
    ],
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
  lastSeenAt: string | null;
  serverInfo: Record<string, unknown> | null;
};
