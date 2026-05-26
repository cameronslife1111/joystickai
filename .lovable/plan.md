## Add "View prompt" option to media gallery action sheet

Add a new entry in the long-press / three-dots action sheet on `/media` that opens a dialog showing the prompt used to generate the asset, with a Copy button.

### Where the prompt lives

Each generated asset stores its prompt in `media_assets.generation_params.user_text` (jsonb). This is populated for:
- User-generated images/videos from the gallery (Generate, Regenerate, Remix, Image-to-Video, Video-to-Video, Audio+Image-to-Video).
- Plan-generated assets (rows with `generation_params.origin === "plan"` also include `user_text`).

Older uploaded assets have `generation_params = null` — for those we show a muted "No prompt available for this asset" message instead of hiding the menu item (keeps the menu position consistent).

### Edit in `src/routes/_authenticated/media.tsx`

1. Add an `import { FileText } from "lucide-react"` (or reuse an existing icon — `FileText` is the most semantically right one, alongside the existing `Copy` already imported).
2. Add local state: `const [promptAsset, setPromptAsset] = useState<MediaAsset | null>(null);`
3. In the action sheet (around line 826, after the Rename/Download buttons and before the kind-specific actions), insert a new `SheetButton`:
   - Icon: `<FileText className="h-4 w-4" />`
   - Label: `"View prompt"`
   - `onClick`: capture `sheetAsset` into a local, close the sheet, set `promptAsset`.
   - Shown for both images and videos (i.e. not gated by `kind`).
4. Render a new modal (same visual style as the Rename dialog — centered card, `bg-card`, rounded, dark overlay) when `promptAsset` is set:
   - Title: "Prompt"
   - Body: read `promptAsset.generation_params?.user_text` (cast `generation_params` as `{ user_text?: string } | null`). If present, render in a scrollable `<div>` (max-height ~60vh, `whitespace-pre-wrap`, `text-sm`, selectable). If missing, render muted "No prompt available for this asset."
   - Footer: a "Copy" button (using the existing `Copy` icon) that calls `navigator.clipboard.writeText(text)` and fires a `toast.success("Prompt copied")` via the already-imported `toast`. Disabled when no prompt exists. Also a "Close" button.
   - Closing the dialog (overlay click, Close button, or Escape) sets `promptAsset` to `null`.

### Notes

- No DB or schema changes. Read-only access to existing `generation_params.user_text`.
- No change to the grid, viewer, plan flow, or any other action. The new option simply joins the existing menu list.
- Works identically whether the asset was created in the gallery or by an Orby plan, since both write `user_text` into `generation_params`.
- Frontend-only change; no server functions touched.