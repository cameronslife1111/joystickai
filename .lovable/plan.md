# Supercharge Orby's planning mode

## What's actually wrong

I traced the full planning pipeline (`plan-compose` → planner LLM → `plan-step` executor, with the shared tool catalog and fuzzy-lookup helpers). The planner is weak for a few concrete, fixable reasons — not because the model is bad:

### 1. The planner is BLIND to your media (the biggest problem)
Documents get a complete **DOCUMENT CATALOG** — every title in your workspace is listed for the planner to read and loosely match against. Media (images, videos, audio) gets **none of that**. Media titles are only shown when *both* a "reuse intent" keyword regex fires (regenerate/remix/edit/animate/etc.) *and* a strict "strong match" passes. For most requests the planner sees **zero image/video titles**, so it literally cannot loosely match "the sunset image" to an asset called "Golden hour over the bay." This guard was added to stop old images resurfacing on scheduled runs, but it over-corrected and hid the whole library.

### 2. Media lookup is dumb compared to document lookup
`find_document_by_title` uses tokenized, emoji-aware, shortcode-aware fuzzy scoring. `find_media_by_title` is a plain substring (`ilike`) match — no emoji synonyms, no shortcode awareness, no real fuzzy scoring, returns only 5. So even when the planner does call it, loose titles miss.

### 3. There's no "look through ALL the titles" media step
Documents have `find_documents_by_title` (plural — enumerate every match for bulk work). Media has no equivalent, and there's no media catalog to enumerate from. You explicitly want "look through all the titles and pick the ones I mean" as a single plan, for docs **and** images/videos. Right now that's only possible for docs.

### 4. Remix guidance is thin
`remix_images` is described mechanically (combine 2-16 images) but the planner gets no guidance on *when* to remix vs regenerate vs generate, or how to resolve the multiple image ids it needs first. Combined with problem #1 (no media visibility), it can't reliably pick the ids to remix.

## The fix

All changes are in the planner backend (the edge functions that build the plan). No UI changes.

### A. Give the planner a full MEDIA CATALOG (mirrors the doc catalog)
In `plan-compose`, always inject a **MEDIA CATALOG** listing every media asset as `id — kind — title — src` (capped generously, most-recent first), exactly like the DOCUMENT CATALOG. Frame it identically: a **lookup table only**, "do NOT act on an asset just because it appears here; only use it if THIS request references it." This restores loose title matching while keeping the anti-stale-media isolation rule (the planner is told not to act on catalog items the request doesn't name). Keep the existing separate "strongly matched MEDIA" inlined section for assets the request clearly points at.

### B. Make media matching as smart as document matching
Rewrite `find_media_by_title` (in `plan-step`) to use the shared `tokenizeRich` + `applyEmojiSynonyms` + shortcode-aware scoring helpers already used for documents, scoring across title **and** the original generation prompt, returning best-first with a higher cap. Same loose-matching quality docs already enjoy.

### C. Add a "look through all media" enumeration tool
Add `find_all_media_by_title` (plural, mirrors `find_documents_by_title`) to the tool catalog and `plan-step`: returns **every** matching image/video/audio (not just 5) so the planner can emit a single "scan all titles, pick the ones the user means" step and pipe the chosen ids into later steps. Update the planner prompt to prefer enumerating from the MEDIA CATALOG directly, and to use this tool when the set may exceed the catalog window.

### D. Strengthen the planner's instructions for media + remix
Add an explicit **MEDIA REFERENCE & REMIX** section to the `plan-compose` system prompt (and the `expand_plan` runtime prompt) covering:
- Resolve image/video references loosely against the MEDIA CATALOG the same way as docs (don't demand exact titles; match on keywords, emoji, source-prompt text).
- A clear decision guide: `generate_image` (new), `regenerate_image` (one source + change), `remix_images` (2-16 sources combined) — with how to resolve and template the source ids first.
- Make the `expand_plan` snapshot reuse the same catalog framing so per-item loops can target the right media ids.

### E. Tighten the loose-match guidance so "loosely match a title" is a first-class behavior
Update the matching rules in the prompt to state plainly: for documents *and* media, never require an exact title; pick the single closest catalog id by common-sense semantic match; only fall back to a `find_*` tool when nothing in the catalog plausibly fits.

## Technical details / files touched
- `supabase/functions/plan-compose/index.ts` — add MEDIA CATALOG injection (parallel to DOCUMENT CATALOG); extend system prompt with the media-reference + remix decision guide and stronger loose-match rules; register the new tool name in validation/`REQUIRED_TARGET_ARGS` if needed.
- `supabase/functions/_shared/tools.ts` — add `find_all_media_by_title` tool def; sharpen `find_media_by_title` / `remix_images` descriptions.
- `supabase/functions/plan-step/index.ts` — rewrite `find_media_by_title` to use `tokenizeRich`/emoji/shortcode scoring; add `find_all_media_by_title` handler; broaden the `expand_plan` snapshot framing.
- After changes: deploy the three edge functions and run a couple of test plans ("remix the X and Y images into …", "find all my sunset images and …") to confirm the planner resolves media loosely and remixes correctly.

## Out of scope
No changes to the slot grid, the editor UI, or document/sentence behavior — this is purely about making the planner resolve media and build correct steps.
