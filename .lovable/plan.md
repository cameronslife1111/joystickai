# Chat settings: full-page panel instead of a cramped popup

## What changes

The gear icon stops opening a narrow 288px popover. It opens a proper settings panel over the chat — near full-screen on phones, a wide centered panel on desktop — with everything visible at once and no scrolling in normal use.

### Layout

```text
+-------------------------------------------------------+
|  Chat settings                                    (X) |
+-------------------------------------------------------+
|  [ Auto approve plans                          [x] ]  |  highlighted row
|  [ Read replies aloud                          (o) ]  |
+-------------------------------------------------------+
|  What Orby can do in this chat                        |
|  (stays checked until you uncheck it)                 |
|                                                       |
|  [ Planning / multi-step  [x] ] [ Document editing [ ] ]|
|  [ Image generation   [ ] ]     [ Video generation [ ] ]|
|  [ Web search         [ ] ]     [ Scheduling      [ ] ]|
|  [ Image analysis     [ ] ]                            |
+-------------------------------------------------------+
|  Attach                                               |
|  [Image titles] [Image to analyze] [Documents]        |
+-------------------------------------------------------+
|  Clear all checks                              [Done] |
+-------------------------------------------------------+
```

- Capabilities become tappable cards in a 1-column grid on phones, 2 columns on tablet, 3 on desktop. The whole card is clickable, not just the checkbox, and a checked card gets a visible accent border/tint so state reads at a glance.
- "Auto approve plans" and "Read replies aloud" sit at the top in their own pair of rows since they're chat-wide behavior, not per-capability.
- Attach actions become one row of three buttons, wrapping on narrow screens.
- "Clear all checks" moves to the bottom bar next to a Done button, and stays visible (disabled) when nothing is checked instead of appearing/disappearing.
- The stale "Use for this message / boxes clear after each send" wording is corrected — checks are sticky per chat, which is how the code actually behaves.

### Behavior

No logic changes. Same seven capability toggles, same sticky per-chat persistence, same auto-approve flag, same auto-speak preference, same three attach pickers. Only the presentation changes.

## Technical notes

- `src/components/ChatDialog.tsx`: replace the `Popover`/`PopoverContent` around the gear trigger with a `Dialog` (`settingsOpen` state reused as-is) using `sm:max-w-2xl` and a `max-h-[90svh]` body; header/footer fixed, middle area scrolls only as a fallback.
- Capability cards render from the existing `CAP_LABELS` array inside `grid gap-2 sm:grid-cols-2 lg:grid-cols-3`; each card is a `button` wrapping label + hint + `Checkbox` (checkbox non-interactive/`pointer-events-none` so the card owns the click) calling the existing `setCap`.
- `clearCaps`, `setAutoApprovePlans`, `setAutoSpeakPref`, `setTitlePickerOpen`, `setImagePickerOpen`, `setDocPickerOpen` are all reused unchanged.
- Drop now-unused `Popover` imports if nothing else in the file uses them.

## Verification

At 390px wide, open the gear: every toggle and attach button is reachable without scrolling past the fold; tapping a card toggles it; Clear all empties everything; reopening the chat shows the same checks still on.
