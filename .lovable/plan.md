# Fix "GetClipList" error and add real clip duplication in Resolve

## What actually went wrong

The helper on your Mac looks for clips in only one place: the bin that Resolve has "currently
open" in the Media pool. Two things break there:

- If Resolve has never had a bin selected in this session (common when you start on the Edit
  page), Resolve hands back nothing for that bin — and the helper then calls `GetClipList()`
  on nothing. That is the exact `'NoneType' object has no attribute 'GetClipList'` message.
- Even when a bin is selected, the search never looks inside sub-bins, so a clip filed in a
  folder wouldn't be found.

Separately, there is no command for what you asked for. The closest one only *appends* a media
pool clip to the end of the timeline — it can't put a copy on a chosen track at the same start
time. So even after the None error is fixed, the job you described still couldn't complete.

## The fix

1. **Never touch a missing Resolve object again.** Every step that reaches for the media pool,
   a bin, a timeline, a track or a clip first checks it exists and, if not, says plainly what to
   do ("Resolve returned no media pool — open a project", "no bin is selected, open the Media
   page once", "video track 6 doesn't exist yet"). No more Python-style errors reaching the chat.

2. **Find clips anywhere.** Clip lookup falls back to the root bin and walks every sub-bin,
   matching exact name first, then partial. Names are compared ignoring case and stray spaces,
   so "x290 - BASE TRIMMED .mp4" matches whether or not the odd space is typed.

3. **New command: copy a timeline clip to another track at the same position.** You say
   "copy the x290 - BASE TRIMMED .mp4 clip onto video track 6 at the same spot" and it:
   - finds every matching clip on the timeline (all tracks, or a named one),
   - reads its exact source in/out frames and its timeline start frame,
   - adds video track 6 if the timeline doesn't have it yet,
   - places the copy on track 6 starting on that same frame,
   - leaves the original completely untouched,
   - reports back "copied 1 clip to V6 at 01:00:12:04".

   Where the clip has no underlying media pool item (compound clips, Fusion clips, titles), it
   says so for that clip and still copies the others.

4. **Detailed logging you can read.** The helper prints one line per attempted step in Terminal
   (which bin, which track, which frames), and failures come back with the object that was
   missing rather than a bare Python message.

## What you'll do once

The helper on your Mac gets a new version, so run the same one-line command in Terminal one
more time to pick it up. The setup card will say so, and the old helper will report that it's
out of date instead of misbehaving.

## Technical detail

`bridge/orby-bridge.mjs` (embedded Python worker):

- Add guarded accessors: `pool()` raises a clear message when `GetMediaPool()` is None;
  new `folder()` uses `GetCurrentFolder()` and falls back to `GetRootFolder()`, raising when
  both are None; `clip_list(f)` returns `f.GetClipList() or []` only after a None check.
- `find_clip(name)` becomes a recursive walk from `GetRootFolder()` through `GetSubFolderList()`,
  exact-then-partial match on normalised names; returns the first hit, error names the bins searched.
- New `find_timeline_items(name, kind, track=None)` using `GetItemListInTrack` across all video
  tracks with normalised name matching.
- New tool `copy_clip_to_track`: args `clip` (name), `to_track` (int), optional `from_track`,
  `track_type` (default video), `all_matches` (default true). For each item: read
  `GetSourceStartFrame`/`GetSourceEndFrame` (fall back to `GetLeftOffset` + `GetStart`/`GetEnd`
  duration math where those are unavailable), `GetStart()` for `recordFrame`, and
  `GetMediaPoolItem()` — skip with a message when None. Ensure the target track exists via
  `GetTrackCount`/`AddTrack`. Insert with the dict form of
  `MediaPool.AppendToTimeline([{ "mediaPoolItem":…, "startFrame":…, "endFrame":…,
  "trackIndex": to_track, "recordFrame": start }])`, which does not disturb existing items.
  Returns copied clip names, target track, and record timecode.
- Bump `BRIDGE_VERSION` to `"3"`; add a `log()` helper writing step lines to stderr.

`src/lib/mcp-providers.ts` — add `copy_clip_to_track` to the catalogue (group: clips) with the
example phrase, so both the planner and the in-app "What can I ask for?" list show it; the count
in that heading updates accordingly.

`supabase/functions/_shared/tools.ts` — include the new command name in the `resolve_command`
guidance so plans can select it.

## Verification

Typecheck, build log, `node --check` on the bridge plus a Python compile of the embedded worker,
and a check that the install route still serves the updated script. The live copy-to-V6 run can
only be confirmed on your Mac — re-run the one-line command, ask for the copy again, and tell me
what Terminal prints if anything still misfires.
