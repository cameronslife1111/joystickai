# Auto-read Orby's chat replies aloud

Add an opt-in "read replies aloud" mode to the chat. When on, every AI text
reply is spoken automatically the moment it appears, and plan actions get a
short cute spoken cue ("Planning now", "Generating that image now", etc.).
Everything reuses the chat's existing speech plumbing, so it never interferes
with how documents are read on the main screen.

## How it stays isolated (no cross-talk with document speech)

- All new speech lives inside `ChatDialog.tsx` and uses `window.speechSynthesis`
  exactly like the existing per-message Play button.
- The main screen already stops speaking whenever the chat is open: the
  auto-repeat timer skips while `chatOpen` is true, and document gestures are
  blocked behind the chat overlay. So no changes to `app.tsx` are needed.
- On chat close, speech is already cancelled (existing effect). We keep that.
- When the chat is closed, the main screen resumes reading sentences on swipe /
  jump exactly as before — untouched.

## Changes (all in `src/components/ChatDialog.tsx`)

### 1. New toggle in the "Orby capabilities" panel
- Add a client-only preference `autoSpeak`, stored in `localStorage`
  (key `orby_chat_autospeak`), default **off**. Read on mount, write on change.
- Render a switch labeled "Read replies aloud" (hint: "Automatically speak
  Orby's answers") directly under the existing capability toggles.
- Keep it OUT of the `caps` object so the server tool logic and the
  "N/6 capabilities on" count are unaffected.

### 2. Shared speak helper (reuse existing Stop button)
- Refactor the current `toggleSpeak` into a small `speakMessage(id, text)` that
  cancels any current utterance, sets `speakingId = id`, and speaks. Keep
  `toggleSpeak` behavior for the manual button (tap again = stop).
- Because auto-speak sets `speakingId` to the message's id, the existing
  Play/Stop button under that message immediately shows as **Stop**, so the
  user can tap it to stop — satisfying the "stop button underneath the output"
  requirement with the control already there.

### 3. Auto-speak text replies
- In `handleSend`, right after the assistant text message is inserted, if
  `autoSpeak` is on and the chat is open, call `speakMessage(msg.id, result.text)`.
- Works on iOS because `speechSynthesis` is already unlocked once on first
  gesture in `__root.tsx`, so speaking after the network round-trip is honored.

### 4. Cute spoken cues for plan actions
- When a plan message is created (route === "plan"), if `autoSpeak` is on,
  speak a short cue immediately: "Planning now."
- In `PlanProgressCard`, when `autoSpeak` is on, announce the action once as the
  plan starts running, chosen from the plan's steps/tools:
  - image generation → "Generating that image now"
  - video generation → "Making those videos now"
  - document editing → "Editing your document now"
  - otherwise → "Working on that now"
  Use a ref to announce each phase only once (no repeats on the 2.5s poll), and
  only while the chat is open. `autoSpeak` is passed into `PlanProgressCard` as a
  prop.

### 5. Cleanup / safety
- Keep the existing on-close `speechSynthesis.cancel()` effect.
- Guard every auto-speak call with `open === true` and `autoSpeak === true`.
- Strip emojis before speaking (existing `stripEmoji` helper).

## Out of scope
- No changes to `app.tsx`, the document reading logic, the global mute, or any
  server / edge functions.
- Uses the browser Web Speech API already in use — no new voice provider.

## Verification
- Typecheck the project.
- Manually confirm on mobile viewport: toggle on → send a message → reply is
  read aloud, Stop button under it works; toggle off → silent; close chat →
  document reading works normally on swipe.
