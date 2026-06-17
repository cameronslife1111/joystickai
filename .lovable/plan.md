# Add circle filters to the "Send to" list picker

## Goal
When you press Orby → "Send to", the "Send to which list?" screen has a "Search lists…" box. Add the same colorful circle buttons used elsewhere so you can quickly narrow the lists. Tapping a circle drops that circle into the search box and filters the lists.

## Change
In `src/routes/_authenticated/app.tsx`, inside the `sendStage === "doc"` overlay (just above the existing `Search lists…` `Input` around line 2692), add a wrapping circle filter row:

- A `flex flex-wrap gap-1.5` row rendering the existing `EMOJI_FILTERS` array (`⚪️ ⚫️ 🟣 🔵 🔴 🟢 🟡 🟠 🟤`).
- Each button calls `setSendSearchQuery(emoji)`, mirroring the existing pattern in `DocumentPickerSheet` / `LinkDocumentDialog` (same 9×9 rounded styling and `active:scale` behavior).
- The existing filtering logic already matches `sendSearchQuery` against the list title, so the circle's emoji will filter results automatically (titles that contain that circle emoji), exactly like the other search areas.

No backend or business-logic changes — this is purely the send-to picker UI.

## Verification
- Press Orby → Send to → confirm a row of circles appears above the search box.
- Tap a circle: it populates the search field and narrows the lists to titles containing that circle.
- Clearing the search text restores the full list.
