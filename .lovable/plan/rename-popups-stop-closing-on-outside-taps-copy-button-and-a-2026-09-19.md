# Rename popups stop closing on outside taps + copy button, and a mute button for the live call

## Rename / title popups

**What you'll see:** When you're renaming anything (a photo or video title, a folder, a chat), tapping outside the popup no longer closes it — what you typed stays put. The popup only closes when you press **Cancel** or **Save**. Every rename popup also gets a small **Copy** button next to the text field that copies the current title to your clipboard (a brief "Copied" confirmation appears).

**Where it changes:**
- `src/routes/_authenticated/media.tsx` — the media gallery Rename dialog (line ~1250): remove the backdrop `onClick` that closes it.
- `src/components/MediaFoldersView.tsx` — the folder Rename dialog (line ~298): same removal.
- `src/components/MediaGalleryPicker.tsx` — the image-title Rename dialog inside the picker sheet (line ~258): same removal.
- `src/components/ChatDialog.tsx` — the "Rename thread" dialog (line ~2370, shadcn `Dialog`): block outside-click and Escape from closing it (`onInteractOutside` / `onEscapeKeyDown` preventDefault on `DialogContent`), so only Cancel/Save close it.
- Add a Copy button in each of these popups using `navigator.clipboard.writeText(...)` with a toast confirmation. Everything else (Enter saves, pre-filled title, existing save logic) stays exactly as-is.

## Mute button on the live call

**What you'll see:** During a hands-free call there is now a **mute button** next to the hang-up button — both in the chat's toolbar (when the chat is open) and in the floating pill at the top of the screen (when the chat is closed). Tap it and your microphone goes silent — Orby can't hear you while you talk to someone else. The button shows a slashed mic while muted; tap again to unmute. The call itself stays connected the whole time, and the hang-up button is unchanged. The mute button only appears while a call is live, and a call always starts unmuted.

**How it works:**
- `src/lib/use-live-voice.ts` — add a `muted` state and `toggleMute()`: sets `enabled = false/true` on the outgoing mic track in the WebRTC connection. This keeps the call and the mic permission alive but sends silence; it does not re-negotiate or hang anything up. `stop()` already releases the track, so muting can't leak past the call.
- `src/lib/hands-free.tsx` — expose `muted` / `toggleMute` on the `HandsFreeApi` context. In `HandsFreeIndicator` (the floating pill shown when the chat is closed), add a mic/mic-off button beside the existing hang-up button; tapping the pill's label still ends the call, mute is a separate button.
- `src/components/ChatDialog.tsx` — in the chat toolbar, when `voice.live`, show a mute button (Mic / MicOff icon) next to the red phone button, wired to the same context so both places stay in sync.

## Verification

- Typecheck passes and the build log is clean.
- Manual preview check: open a rename popup, tap outside — it stays; copy button copies; live call shows mute in both the chat toolbar and the floating pill, muting/unmuting works, hang-up still ends the call.
