## Problem
`PlanDetailDialog` (the popup that opens when tapping a completed or failed plan in the AI Plans screen) is being pushed wider than the viewport on mobile, forcing a left/right scroll to read the summary and step results.

## Root cause
Two things inside the dialog produce intrinsic widths larger than the screen:

1. The per-step result block renders pretty-printed JSON inside `<pre class="overflow-x-auto">`. The pre never wraps, so a single long token (a URL, a fal request id, etc.) sets its intrinsic width.
2. The step row uses `flex` with a `flex-1` child but no `min-w-0`. Flex children default to `min-width: auto`, so the pre's intrinsic width propagates up and stretches the whole `DialogContent` past `w-[calc(100vw-2rem)]`.

The error message block (`whitespace-pre-wrap` only) has the same exposure for long unbreakable strings like stack traces or URLs in the failure message.

## Fix (scoped to `src/components/PlanDetailDialog.tsx`)

1. `DialogContent`: add `overflow-x-hidden` alongside the existing `overflow-y-auto` as a hard backstop so nothing can push the dialog past the viewport.
2. Step `<li>`: add `min-w-0` so the row can't grow past its parent.
3. The flex row inside each step (`<div class="flex items-start gap-2">`) and its `flex-1` child: add `min-w-0` to both so children participate in shrinking.
4. Step description and error text: add `break-words` (and `break-all` on the error block, since fal/api errors often embed long IDs) so unbreakable tokens wrap instead of widening the row.
5. Result block: replace `<pre class="overflow-x-auto">` with a wrapping presentation — `whitespace-pre-wrap break-all` — so the JSON snippet flows vertically. Keep the 400-char truncation already in place.
6. Top-level sections (`Your request`, `Summary`, `What went wrong`): add `break-words` so pasted long URLs in user requests don't reintroduce the same overflow.

## Out of scope
- AIPlansScreen list itself — only the detail dialog is reported broken.
- Visual redesign of the dialog. This change is layout-only; spacing, colors, and content stay the same.

## Verification
At 390×701 (current preview viewport):
- Open a completed plan with multi-step results — confirm no horizontal scrollbar on the dialog, and the JSON preview wraps inside the card.
- Open a failed plan whose `error_message` contains a long URL or fal id — confirm the red error block wraps and the dialog stays within the viewport.
- Close button (X) remains in the top-right corner as today.
