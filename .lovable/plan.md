# Give Orby a real Resolve command list (and grow it to 100)

## Why "disable all the tracks" and "make it vertical" failed

The connection is fine — Orby really is talking to Resolve Studio on your Mac. The
problem is the menu of things it knows how to do. Right now the bridge only
understands 13 commands: project info, list/create/switch timelines, list/import media,
append a clip, set a clip property, grade saturation, apply a LUT, add a Fusion effect,
render, and check render status. Two of them (transitions, Text+ titles) always answer
"can't do that".

Turning tracks on and off, and changing the timeline resolution to vertical, are both
things Resolve's own scripting supports — Orby just had no command for them. So this
isn't a limitation of Resolve, it's a gap in our list.

## What this does

1. **Expand the bridge from 13 commands to 100**, grouped so you can talk naturally:

   - **Project & session (1–12)** — session info, list/open/create/save/close projects,
     switch pages (Edit, Color, Fusion, Fairlight, Deliver), read and set project
     settings, list all available settings.
   - **Timelines (13–28)** — list, create, open, rename, duplicate, delete, set
     resolution/frame rate/aspect (including one-shot "make it vertical 1080x1920",
     "square 1080x1080", "16:9 UHD"), read start timecode, timeline item counts.
   - **Tracks (29–44)** — count tracks, list track names, rename, add/delete video,
     audio and subtitle tracks, enable/disable one track, **enable or disable all
     tracks at once**, lock/unlock one or all, solo and mute audio tracks.
   - **Clips on the timeline (45–62)** — list clips per track with in/out and duration,
     move the playhead, select a clip, set clip colour and flags, retime/speed, zoom,
     position, crop, opacity, rotation, volume, pan, delete a clip, link/unlink.
   - **Media pool (63–76)** — list folders, create subfolders, move and delete clips,
     import files and folders, import a timeline file, read and set clip properties,
     find clips by name, create a bin from a folder on disk, list proxy state.
   - **Colour (77–86)** — apply a LUT, set CDL values, saturation/contrast/pivot where
     Resolve exposes them, list/add/load colour versions, copy a grade between clips,
     grab a still, apply a saved still or .drx grade.
   - **Fusion & effects (87–92)** — add a Fusion node (delta keyer for green screen,
     transform, blur, glow), set node inputs, list nodes on a clip, delete a node,
     add/remove a Fusion composition.
   - **Markers & metadata (93–96)** — add, list and delete timeline markers, set clip
     metadata.
   - **Export & render (97–100)** — list render presets/formats/codecs, queue a render
     with a preset or explicit format/resolution, start/stop rendering, read job status,
     export the timeline as AAF/EDL/XML/OTIO.

   Anything Resolve genuinely can't script (transitions, Text+ titles, some colour
   wheels) keeps answering with a plain sentence telling you to do that bit by hand,
   rather than pretending.

2. **A numbered reference you can read in the app.** The DaVinci Resolve setup card
   gains a "What can I ask for?" section: the full numbered 1–100 list, grouped by the
   headings above, each line saying in plain words what it does and an example phrase
   ("turn off every video track", "make this timeline vertical", "export a 9:16 short to
   my Movies folder"). Same list is what Orby's planner sees, so what you read is exactly
   what it can do.

3. **Ask Orby directly.** "What can you do in Resolve?" answers from that same list
   instead of guessing.

## One thing to know

The bridge helper on your Mac gets a new version, so after this you run the same
one-line command once more to pick it up. The card will say so, and the old helper will
print "a newer helper is available" instead of silently misbehaving.

## Technical detail

- `bridge/orby-bridge.mjs` — the embedded Python worker's `call()` grows from 13 to 100
  `tool ==` branches, organised in the groups above, each mapping to the documented
  Resolve scripting API (`SetTrackEnable`, `SetTrackLock`, `AddTrack`, `SetSetting`
  for `timelineResolutionWidth/Height`/`timelineFrameRate`, `AddMarker`, `SetCDL`,
  `GetRenderFormats`/`GetRenderCodecs`, `Export`, `GrabStill`, version APIs, etc.).
  Every branch raises a plain-language message on failure. A `BRIDGE_VERSION` constant is
  bumped and sent with `server_info`.
- `src/lib/mcp-providers.ts` — the `tools` array becomes the full 100-entry catalogue
  (`name`, `description`, `example`, `group`), plus a `groups` array for rendering. This
  is the single source both the planner and the UI read.
- `src/components/mcp/McpConnectionPanel.tsx` — collapsible "What can I ask for?"
  section rendering the numbered list from the provider entry, grouped with headings.
  Provider-agnostic, all strings from the registry.
- `supabase/functions/_shared/tools.ts` — the `resolve_command` tool description embeds
  the grouped tool names so the planner picks real commands; unknown names are rejected
  before they reach the bridge.
- `src/routes/api/public/mcp-bridge/install.ts` and the poll route add a bridge-version
  check so an out-of-date helper is reported in the status pill.

## Verification

Typecheck, build log, `node --check` on the bridge and a Python compile of the embedded
worker, a check that the install route still serves the script, and a Playwright pass at
390px on the expanded card. The live Resolve calls (track disable, vertical timeline,
render) are yours to try once you re-run the one-line command — tell me what Terminal
prints and I'll fix anything that misfires.
