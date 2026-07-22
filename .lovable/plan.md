Add an invisible tap zone on the left edge of the orb area that fires the same "Next linked doc" action as Slot 24.

Scope
- File: `src/routes/_authenticated/app.tsx` (orb tap-zone layer where the existing invisible orb-edge zones live, e.g. the left-of-orb delete zone).
- Add a new absolutely-positioned invisible button:
  - Width ~10px, height ~50px
  - Vertically centered on the orb (top: 50%, translateY(-50%))
  - Positioned just off the left side of the orb, in the center of the screen area
  - `background: transparent`, no border, `aria-label="Next linked doc"`
  - `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`
  - Only active on the main swipe screen (same visibility conditions the other orb zones use — hidden while editing, in dialogs, etc.)
- On press/click, calls the exact same handler Slot 24 (📚 Next linked doc) uses — `openNextLinkedDocument()` — no duplication of logic.
- Works on both mouse (`onClick`) and touch (native click covers both; no need for a separate touch handler).

Guardrails
- Do not change Slot 24 behavior.
- Do not affect existing left-of-orb delete zone or other invisible zones; place this new zone at a different vertical position or on a distinct region so they don't overlap. If there's a conflict, I'll shift the new zone slightly (e.g. slightly above or below the delete zone) and note it — but the plan is to keep it centered vertically on the orb; I'll confirm no overlap with the delete zone during implementation and adjust position by a few px if needed.
- Purely frontend/UI change. No backend, no new state.