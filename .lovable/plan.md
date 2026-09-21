# Paint on any image

Add a paint brush button to both image viewers — the gallery's full-screen viewer and the image popup inside chats — that opens the picture in a drawing editor.

## What the user gets

A brush button on the picture. Tapping it opens the same image filling the screen with a small tool bar:

- Brush — draw with a finger, stylus or mouse
- Size — slider for how thick the brush circle is
- Color — a row of colors plus a full color picker
- Eraser — rubs out paint only, never the photo underneath
- Text — tap the picture to place words, drag to move, slider to resize, same colors to recolor
- Undo — steps back one change at a time (each stroke, each text placement, each move)
- Clear all — wipes every stroke and all text, photo untouched
- Cancel — closes without saving
- Save — asks: "Save as copy" (a new picture named e.g. "Sunset (painted)") or "Replace original" (the painted version shows everywhere that picture appears)

Works the same on phone and computer: touch drawing, pinch-free single-finger strokes, buttons sized for thumbs, and the bar sits above the phone's home area.

## Technical notes

New component `src/components/PaintImageDialog.tsx`:

- Full-screen dialog. Loads the image through `proxyMediaUrl` into an offscreen source canvas at natural size; a paint canvas of identical pixel size sits on top, scaled with CSS to fit the screen.
- Pointer events (`pointerdown/move/up`, `touch-action: none`) map screen coords to image pixel coords. Brush = round line caps, `lineJoin: round`; eraser = same path with `globalCompositeOperation: "destination-out"` on the paint layer only.
- History: paint layer snapshots pushed on each completed stroke (cap ~20, dropping oldest) plus a text-object array; undo pops the combined step stack. Text items are objects `{ id, text, x, y, size, color }` rendered on a separate pass so they stay editable/movable until save.
- Save flattens source image → paint layer → text layer into one canvas, exports via `toBlob` (jpeg for jpeg sources, otherwise png).
  - Save as copy: upload to `joystick-media` at `${userId}/${Date.now()}_painted.ext`, insert a `media_assets` row mirroring `ShrinkImageDialog` (`generation_params: { mode: "paint", source_asset_id }`), title `${baseTitle} (painted)`, then invalidate `media_assets`.
  - Replace original: upload a new object path, then update the existing row's `url`, `storage_path`, `mime_type`, `size_bytes`, `width`, `height`, and remove the old storage object. New path (not overwrite) so caches don't serve the stale picture.
- Wiring: gallery viewer in `src/routes/_authenticated/media.tsx` gets a brush button in the chrome row for `kind === "image"`; `src/components/ChatMedia.tsx` gets a brush button in its image dialog and invalidates `chat_media` + `media_assets` after save.
- No schema, bucket or policy changes — reuses the existing bucket, row shape and per-user paths.
