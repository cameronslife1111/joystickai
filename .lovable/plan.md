# Fix the media-pool scan error in DaVinci Resolve

## This one is not your fault

Nothing you asked for was wrong, and nothing about how you phrased it caused this. It's a
genuine bug in the helper that runs on your Mac.

## What actually happened

The helper has a small routine named `folder` that answers "which bin are we looking in?".
Elsewhere in the same block of code, an unrelated command (relinking clips) reuses that same
word `folder` as a plain value. Because of how Python scoping works, that one reuse makes the
name a local variable for the *entire* block — so when the media-inventory step calls the
routine, Python complains it was "referenced before assignment" and the step dies before ever
talking to Resolve.

So the project opened and the timeline check passed (those don't touch that routine), and then
listing the media pool failed instantly. Same cause would hit "create a bin" too.

## The fix

1. Rename the local value in the relink command so it no longer collides with the bin lookup.
   The media-pool scan, bin creation, and everything downstream then work normally.
2. Guard against this class of bug returning: a small test scans the helper for any local name
   that shadows one of its own helper routines and fails if one appears again.
3. Bump the helper version so your Mac copy reports itself out of date until you refresh it.

Nothing about the workflow, commands, or the rest of the integration changes.

## What you do once

Run the same one-line setup command in Terminal one more time to pick up the new helper, then
ask for the slideshow again. After that the media scan should list your pictures and song, and
the plan can continue placing them on "Cameron Images Timeline" and saving.

## Technical detail

- `bridge/orby-bridge.mjs`, embedded Python worker: in `call()`, the `relink_clips` branch
  assigns `folder = os.path.expanduser(...)`, shadowing the module-level `folder()` helper for
  the whole function and causing `UnboundLocalError` in `list_media_pool_clips` (`f = folder()`)
  and `create_media_pool_folder` (`parent = folder()`). Rename that local to `relink_dir` and
  use it in the call and error message.
- Bump `BRIDGE_VERSION` to `"5"` in both the JS and embedded-Python halves, and in
  `src/lib/mcp-providers.ts` so the existing version-sync test stays green.
- `tests/resolve-provider.test.ts`: add a check that no line inside the worker's `call()`
  assigns a bare local named after a helper function (`folder`, `pool`, `timeline`, `project`,
  `clip_list`, `root_folder`, etc.).

## Verification

`node --check` on the bridge, a Python compile of the embedded worker, a simulated
`list_media_pool_clips` dispatch to confirm no `UnboundLocalError`, typecheck, Vitest, and the
build log. The live Resolve run is yours to confirm after re-running the Terminal command.
