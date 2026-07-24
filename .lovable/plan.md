## Goal
Let a chat message carry several images (not just one) so Orby's image-analysis can compare/describe multiple pictures at once.

## Changes

**1. Chat UI (`src/components/ChatDialog.tsx`)**
- Replace the single `pickedImage` state with `pickedImages: MediaAsset[]`.
- Switch the media picker to `mode="multiple"` with a sensible cap (6 images per message) and pre-select all currently picked images.
- Attachment chip row: show one small chip per picked image with its own ✕ to remove, plus a "Clear" affordance when more than one is attached.
- Send path: pass every picked image's URL; keep the existing "image has no URL yet" guard, applied to all picked images. Clear the picked images after a successful send, as today.

**2. Server (`src/lib/chat.functions.ts`)**
- Accept `imageUrls: string[]` (max 6) alongside the existing single `imageUrl` for backward compatibility; normalize into one array.
- In the vision branch (still gated by the `image_analysis` capability), attach one `{ type: "image", image: url }` block per image after the text block in the latest user message.
- Everything else — document context assembly, routing, plan resume — stays unchanged.

## Notes
- The gallery picker component already supports multi-select, so no changes there.
- Only images picked from the gallery are supported, same as today; this doesn't change where images come from.
