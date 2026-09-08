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

/** Bump together with BRIDGE_VERSION in bridge/orby-bridge.mjs. */
export const BRIDGE_VERSION = "3";

export function bridgeOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return PUBLISHED_ORIGIN;
}

export type McpTool = {
  /** Exact tool name the bridge understands. */
  name: string;
  /** Plain-language description of what it does. */
  description: string;
  /** How the user would ask for it in chat. */
  example: string;
  /** Group heading this tool belongs to. */
  group: string;
};

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
  /** Group headings, in display order. */
  groups: string[];
  /** The full command catalogue — numbered by position. */
  tools: McpTool[];
};

const G_PROJECT = "Project & session";
const G_TIMELINE = "Timelines";
const G_TRACKS = "Tracks";
const G_CLIPS = "Clips on the timeline";
const G_POOL = "Media pool";
const G_COLOR = "Colour";
const G_FUSION = "Fusion & effects";
const G_MARKERS = "Markers & metadata";
const G_RENDER = "Export & render";

const RESOLVE_GROUPS = [
  G_PROJECT,
  G_TIMELINE,
  G_TRACKS,
  G_CLIPS,
  G_POOL,
  G_COLOR,
  G_FUSION,
  G_MARKERS,
  G_RENDER,
];

/** 100 commands Orby can run in DaVinci Resolve, in the order they're numbered. */
const RESOLVE_TOOLS: McpTool[] = [
  // ---------------------------------------------------------- 1–12 project
  { group: G_PROJECT, name: "get_project_info", description: "Read the current project, timeline, frame rate and resolution", example: "What am I working on right now?" },
  { group: G_PROJECT, name: "get_resolve_version", description: "Report the Resolve version and edition", example: "Which version of Resolve am I on?" },
  { group: G_PROJECT, name: "list_projects", description: "List the projects in the current project folder", example: "List my Resolve projects" },
  { group: G_PROJECT, name: "open_project", description: "Open a project by name", example: "Open the project called Beach Film" },
  { group: G_PROJECT, name: "create_project", description: "Create a new empty project", example: "Make a new project called Reels" },
  { group: G_PROJECT, name: "save_project", description: "Save the open project", example: "Save the project" },
  { group: G_PROJECT, name: "close_project", description: "Close the open project", example: "Close this project" },
  { group: G_PROJECT, name: "open_page", description: "Switch pages: media, cut, edit, fusion, color, fairlight, deliver", example: "Go to the Color page" },
  { group: G_PROJECT, name: "get_current_page", description: "Say which page Resolve is showing", example: "Which page am I on?" },
  { group: G_PROJECT, name: "get_project_setting", description: "Read one project setting, or all of them", example: "What's my timeline frame rate set to?" },
  { group: G_PROJECT, name: "set_project_setting", description: "Change any project setting by name", example: "Set the colour science to DaVinci YRGB" },
  { group: G_PROJECT, name: "list_project_settings", description: "List every setting name that can be changed", example: "What project settings can you change?" },

  // -------------------------------------------------------- 13–28 timelines
  { group: G_TIMELINE, name: "list_timelines", description: "List every timeline in the project", example: "List my timelines" },
  { group: G_TIMELINE, name: "get_timeline_info", description: "Name, start timecode, track counts, resolution and frame rate", example: "Tell me about this timeline" },
  { group: G_TIMELINE, name: "create_timeline", description: "Create an empty timeline (name, size, aspect, frame rate)", example: "Create a vertical timeline called Short" },
  { group: G_TIMELINE, name: "set_current_timeline", description: "Open a timeline by name", example: "Switch to the timeline called Rough Cut" },
  { group: G_TIMELINE, name: "rename_timeline", description: "Rename a timeline", example: "Rename this timeline to Final" },
  { group: G_TIMELINE, name: "duplicate_timeline", description: "Duplicate a timeline so you can try something safely", example: "Duplicate this timeline as Final v2" },
  { group: G_TIMELINE, name: "delete_timeline", description: "Delete a timeline by name", example: "Delete the timeline called Test" },
  { group: G_TIMELINE, name: "set_timeline_resolution", description: "Set an exact pixel size, or use a named shape", example: "Make this timeline 1080 by 1920" },
  { group: G_TIMELINE, name: "set_timeline_aspect", description: "One-shot shape change: vertical, square, widescreen, uhd, cinema, 4:5", example: "Change the aspect ratio to vertical" },
  { group: G_TIMELINE, name: "set_timeline_frame_rate", description: "Set the timeline frame rate (only while it's still empty)", example: "Set this to 24 frames a second" },
  { group: G_TIMELINE, name: "get_timeline_start_timecode", description: "Read the timeline's start timecode", example: "What timecode does this start at?" },
  { group: G_TIMELINE, name: "set_timeline_start_timecode", description: "Set the timeline's start timecode", example: "Start this timeline at 01:00:00:00" },
  { group: G_TIMELINE, name: "get_timeline_item_count", description: "Count the clips on video, audio and subtitle tracks", example: "How many clips are in this timeline?" },
  { group: G_TIMELINE, name: "set_timeline_setting", description: "Change a setting on this timeline only", example: "Turn on custom settings for this timeline" },
  { group: G_TIMELINE, name: "import_timeline_file", description: "Import a timeline from an AAF, EDL, XML, OTIO or DRT file", example: "Import the timeline from that XML file" },
  { group: G_TIMELINE, name: "export_timeline", description: "Export the timeline as AAF, EDL, XML, FCPXML, OTIO or DRT", example: "Export this timeline as an XML" },

  // ----------------------------------------------------------- 29–44 tracks
  { group: G_TRACKS, name: "get_track_count", description: "How many video, audio and subtitle tracks there are", example: "How many tracks do I have?" },
  { group: G_TRACKS, name: "list_tracks", description: "List every track with its name, on/off state, lock state and clip count", example: "List all my tracks" },
  { group: G_TRACKS, name: "rename_track", description: "Rename a track", example: "Rename video track 2 to B-roll" },
  { group: G_TRACKS, name: "add_track", description: "Add a video, audio or subtitle track", example: "Add another video track" },
  { group: G_TRACKS, name: "delete_track", description: "Delete a track", example: "Delete video track 3" },
  { group: G_TRACKS, name: "enable_track", description: "Turn one track on", example: "Turn video track 2 back on" },
  { group: G_TRACKS, name: "disable_track", description: "Turn one track off", example: "Turn off video track 2" },
  { group: G_TRACKS, name: "enable_all_tracks", description: "Turn every track on (or every track of one type)", example: "Turn all the tracks back on" },
  { group: G_TRACKS, name: "disable_all_tracks", description: "Turn every track off (or every track of one type)", example: "Disable all the tracks" },
  { group: G_TRACKS, name: "lock_track", description: "Lock one track so it can't be edited", example: "Lock video track 1" },
  { group: G_TRACKS, name: "unlock_track", description: "Unlock one track", example: "Unlock video track 1" },
  { group: G_TRACKS, name: "lock_all_tracks", description: "Lock every track", example: "Lock all my tracks" },
  { group: G_TRACKS, name: "unlock_all_tracks", description: "Unlock every track", example: "Unlock everything" },
  { group: G_TRACKS, name: "mute_audio_track", description: "Mute one audio track", example: "Mute audio track 2" },
  { group: G_TRACKS, name: "unmute_audio_track", description: "Unmute one audio track", example: "Unmute audio track 2" },
  { group: G_TRACKS, name: "solo_audio_track", description: "Solo an audio track — not scriptable, so Orby offers to mute the others instead", example: "Solo audio track 1" },

  // ------------------------------------------------------------ 45–62 clips
  { group: G_CLIPS, name: "list_timeline_clips", description: "List the clips on a track with start, end and duration", example: "What's on video track 2?" },
  { group: G_CLIPS, name: "get_clip_info", description: "Everything Resolve knows about one clip on the timeline", example: "Tell me about the first clip on track 1" },
  { group: G_CLIPS, name: "set_clip_property", description: "Set any clip property by name", example: "Set the second clip's opacity to 50" },
  { group: G_CLIPS, name: "set_clip_color", description: "Colour-tag a clip in the timeline", example: "Make that clip orange" },
  { group: G_CLIPS, name: "set_clip_flag", description: "Flag a clip", example: "Flag the third clip blue" },
  { group: G_CLIPS, name: "clear_clip_flags", description: "Remove the flags from a clip", example: "Clear the flags on that clip" },
  { group: G_CLIPS, name: "set_clip_speed", description: "Retime a clip by percentage (slow motion, speed-up)", example: "Slow that clip to 50 percent" },
  { group: G_CLIPS, name: "set_clip_zoom", description: "Scale a clip up or down", example: "Zoom that clip in to 1.2" },
  { group: G_CLIPS, name: "set_clip_position", description: "Move a clip in frame", example: "Move that clip up a bit" },
  { group: G_CLIPS, name: "set_clip_crop", description: "Crop a clip's left, right, top or bottom", example: "Crop 100 pixels off the left" },
  { group: G_CLIPS, name: "set_clip_opacity", description: "Set a clip's opacity", example: "Make that clip half transparent" },
  { group: G_CLIPS, name: "set_clip_rotation", description: "Rotate a clip", example: "Rotate that clip 90 degrees" },
  { group: G_CLIPS, name: "set_clip_volume", description: "Set the level of an audio clip in decibels", example: "Bring that music down 6 dB" },
  { group: G_CLIPS, name: "set_clip_pan", description: "Pan an audio clip left or right", example: "Pan that audio slightly left" },
  { group: G_CLIPS, name: "delete_clip", description: "Delete a clip from the timeline", example: "Delete the last clip on track 2" },
  { group: G_CLIPS, name: "set_playhead_timecode", description: "Move the playhead to a timecode", example: "Jump to 00:01:30:00" },
  { group: G_CLIPS, name: "get_playhead_timecode", description: "Read where the playhead is", example: "Where's my playhead?" },
  { group: G_CLIPS, name: "append_clip_to_timeline", description: "Append a media pool clip to the end of the timeline", example: "Add the beach clip to the end" },

  // -------------------------------------------------------- 63–76 media pool
  { group: G_POOL, name: "list_media_pool_clips", description: "List the clips in the current bin", example: "What's in my media pool?" },
  { group: G_POOL, name: "list_media_pool_folders", description: "List every bin, nested", example: "Show me my bins" },
  { group: G_POOL, name: "create_media_pool_folder", description: "Create a new bin", example: "Make a bin called B-roll" },
  { group: G_POOL, name: "set_current_folder", description: "Switch to a bin by name", example: "Open the B-roll bin" },
  { group: G_POOL, name: "move_clips_to_folder", description: "Move clips into a bin", example: "Move the drone shots into B-roll" },
  { group: G_POOL, name: "delete_media_pool_clips", description: "Remove clips from the media pool", example: "Delete the unused takes from the pool" },
  { group: G_POOL, name: "import_media", description: "Import files from disk into the media pool", example: "Import that video from my Downloads folder" },
  { group: G_POOL, name: "import_media_folder", description: "Import everything in a folder on disk", example: "Import my whole GoPro folder" },
  { group: G_POOL, name: "get_clip_property", description: "Read a media pool clip's properties (resolution, codec, duration)", example: "What resolution is that clip?" },
  { group: G_POOL, name: "set_media_clip_property", description: "Set a media pool clip property", example: "Set that clip's scene name to Intro" },
  { group: G_POOL, name: "find_clip", description: "Find a clip in the media pool by name", example: "Find the clip called sunset" },
  { group: G_POOL, name: "create_timeline_from_clips", description: "Build a new timeline straight from named clips", example: "Make a timeline from those three clips" },
  { group: G_POOL, name: "relink_clips", description: "Relink offline clips from a folder", example: "Relink my clips from the external drive" },
  { group: G_POOL, name: "unlink_clips", description: "Unlink clips from their media files", example: "Unlink those clips" },

  // ----------------------------------------------------------- 77–86 colour
  { group: G_COLOR, name: "apply_lut", description: "Apply a LUT file to a clip's node", example: "Put my film LUT on that clip" },
  { group: G_COLOR, name: "set_cdl", description: "Set slope, offset, power and saturation on a clip", example: "Lift the shadows on that clip a little" },
  { group: G_COLOR, name: "grade_clip", description: "Convenience grade: saturation, CDL and/or a LUT in one step", example: "Make that clip warmer and more saturated" },
  { group: G_COLOR, name: "list_color_versions", description: "List a clip's colour versions", example: "What grade versions does that clip have?" },
  { group: G_COLOR, name: "add_color_version", description: "Add a new colour version to a clip", example: "Add a grade version called Cool" },
  { group: G_COLOR, name: "load_color_version", description: "Switch a clip to one of its colour versions", example: "Switch that clip back to the original grade" },
  { group: G_COLOR, name: "delete_color_version", description: "Delete a colour version", example: "Delete the Cool grade version" },
  { group: G_COLOR, name: "copy_grade", description: "Copy a grade between clips — Orby explains the still/CDL route Resolve allows", example: "Copy that grade to the next clip" },
  { group: G_COLOR, name: "grab_still", description: "Grab a still of the current frame into the gallery", example: "Grab a still of this frame" },
  { group: G_COLOR, name: "apply_drx_grade", description: "Apply a saved .drx grade file to a clip", example: "Apply my saved grade file to that clip" },

  // ----------------------------------------------------------- 87–92 fusion
  { group: G_FUSION, name: "add_fusion_effect", description: "Add a Fusion node — delta keyer for green screen, transform, blur, glow", example: "Key the green screen off that clip" },
  { group: G_FUSION, name: "set_fusion_input", description: "Change a setting on a Fusion node", example: "Soften the key edges a bit" },
  { group: G_FUSION, name: "list_fusion_nodes", description: "List the Fusion nodes on a clip", example: "What effects are on that clip?" },
  { group: G_FUSION, name: "delete_fusion_node", description: "Delete a Fusion node", example: "Remove the blur from that clip" },
  { group: G_FUSION, name: "add_fusion_comp", description: "Add a fresh Fusion composition to a clip", example: "Give that clip a new Fusion comp" },
  { group: G_FUSION, name: "delete_fusion_comp", description: "Delete a Fusion composition from a clip", example: "Remove the Fusion comp from that clip" },

  // ---------------------------------------------------------- 93–96 markers
  { group: G_MARKERS, name: "add_marker", description: "Add a coloured marker with a name and note", example: "Put a red marker at frame 500 saying fix audio" },
  { group: G_MARKERS, name: "list_markers", description: "List the timeline's markers", example: "What markers are in this timeline?" },
  { group: G_MARKERS, name: "delete_marker", description: "Delete a marker by frame, by colour, or all of them", example: "Delete all the blue markers" },
  { group: G_MARKERS, name: "set_clip_metadata", description: "Set a metadata field on a media pool clip", example: "Set the description on that clip" },

  // ----------------------------------------------------------- 97–100 render
  { group: G_RENDER, name: "list_render_options", description: "List the render presets, formats and codecs available", example: "What export presets do I have?" },
  { group: G_RENDER, name: "render_timeline", description: "Queue and start a render — preset or explicit format, codec, size and folder", example: "Export this as a 9:16 MP4 to my Movies folder" },
  { group: G_RENDER, name: "get_render_status", description: "Check whether a render is still going", example: "Is my export done?" },
  { group: G_RENDER, name: "stop_render", description: "Stop the render that's running", example: "Stop the export" },
];

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
      {
        problem: "Orby says it can't do something you see listed",
        fix: "Your helper is probably an older version. Press Disconnect, then run the one-line command again to pick up the newest one.",
      },
    ],
    installCommand: (code: string) =>
      `curl -fsSL ${bridgeOrigin()}/api/public/mcp-bridge/install -o ~/orby-bridge.mjs && node ~/orby-bridge.mjs connect ${code}`,
    groups: RESOLVE_GROUPS,
    tools: RESOLVE_TOOLS,
  },
};

export const MCP_PROVIDER_LIST = Object.values(MCP_PROVIDERS);

export function providerForCapability(capability: string): McpProvider | undefined {
  return MCP_PROVIDER_LIST.find((p) => p.capability === capability);
}

/** Tools grouped for display, in the provider's group order. */
export function groupedTools(provider: McpProvider): { group: string; tools: { n: number; tool: McpTool }[] }[] {
  const numbered = provider.tools.map((tool, i) => ({ n: i + 1, tool }));
  return provider.groups
    .map((group) => ({ group, tools: numbered.filter((t) => t.tool.group === group) }))
    .filter((g) => g.tools.length > 0);
}

/**
 * The same catalogue as a compact block for prompts, so the planner and the
 * chat assistant only ever offer commands the bridge really has.
 */
export function toolCatalogText(provider: McpProvider): string {
  return groupedTools(provider)
    .map(
      ({ group, tools }) =>
        `${group}: ` + tools.map(({ n, tool }) => `${n}. ${tool.name} — ${tool.description}`).join("; "),
    )
    .join("\n");
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
