# Replace every toast with a tiny emoji chip

All notifications become a small emoji chip in the top-right corner instead of a full text toast.

## What changes for you

1. Notifications appear top-right as a compact rounded chip: one emoji that represents what happened, plus optional very small text (2-4 words max).
2. They disappear after about 1 second (errors stay ~2s so you can register them).
3. When there's something to open, a second 👁️ emoji appears next to the first one — tap it to view (e.g. a finished plan shows 🟣 👁️).
4. When something can be undone, a ↩️ emoji appears next to it — tap it to undo (e.g. a deleted sentence shows 🗑️ ↩️).
5. Progress notifications (uploading, transcribing, importing) show a ⏳ chip that updates in place and vanishes when done.
6. Emoji varies by what happened, for example:
   - ✅ saved / done, ❌ failed, ⚠️ warning
   - 🗑️ deleted, 📋 copied, ✏️ renamed, 📄 document, 📤 sent, 📎 attached
   - 🖼️ image, 🎬 video, 🔊 speech, 🎙️ recording, ⬇️ download, 📁 folder
   - 🟣 plan ready/started, 🟢 plan done, 🔴 plan failed, ⏳ working
7. No other visual change to the app — every existing notification simply switches to this style.

## Technical notes

- New `src/lib/toast.ts` exports a `toast` object that is API-compatible with sonner's (`toast()`, `.success`, `.error`, `.info`, `.warning`, `.loading`, `.dismiss`, options with `id`, `duration`, `description`, `action`). It calls sonner's `toast.custom` under the hood so no call site needs rewriting beyond its import.
  - `pickEmoji(message, description, type)`: keyword table over the message text (delete/copy/rename/upload/download/video/image/plan/send/attach/speech/transcri/folder/background/schedule/sign in…), falling back to the type-based emoji.
  - Renders a `EmojiToast` chip: `rounded-full border bg-background/90 backdrop-blur px-2.5 py-1.5 shadow` with a `text-xl` emoji, optional `text-[10px] text-muted-foreground` label truncated to ~24 chars, and an action button rendering ↩️ for undo-ish labels (`undo`, `restore`) or 👁️ for view-ish labels (`view`, `open`, `details`, `review`, `approve`).
  - Default durations: 1000ms normal, 2000ms error, `Infinity` for `loading`; explicit `duration` in options wins. Existing `duration: Infinity` call sites keep their behavior with a persistent chip.
- Codemod: every `import { toast } from "sonner"` (and the dynamic `await import("sonner")` in `use-composing-plans-watcher.ts`) switches to `@/lib/toast`. ~26 files, no message-text edits needed. `Toaster` imports stay on sonner.
- `src/routes/__root.tsx`: `<Toaster position="top-right" />` with `richColors` removed and `toastOptions={{ unstyled: true }}` plus an offset so chips sit small in the corner; `src/components/ui/sonner.tsx` is left untouched (unused by the root).
- Messages that only make sense as text (e.g. long error details) still show the tiny truncated label under/next to the emoji, and the full text remains in the accessible title attribute.
