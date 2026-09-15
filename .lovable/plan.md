# Clean up the open-chat controls into one icon row

## What will change

Add one compact row of seven icon-only buttons inside the open chat, immediately above the active-capabilities line and message box:

```text
[ Settings ] [ Hands-free ] [ Clear/Delete ] [ Rename ] [ Attach docs ] [ Document titles ] [ Image titles ]
Active capabilities…
Message Orby…
```

Each button keeps its current action:

- Gear opens the full Chat settings page.
- Phone starts or ends the hands-free call and keeps its connecting/live state.
- Red trash can opens the existing Clear or delete this chat confirmation.
- Pencil opens the existing rename dialog with the current title filled in.
- Paperclip opens the attached-documents picker and preserves the current selection/count.
- Document-title icon opens the picker that types selected document titles at the saved cursor position without attaching them.
- Image-title icon opens the gallery that types selected image titles at the saved cursor position without attaching them.

Every icon will have an accessible name and a hover label. Disabled, connecting, live-call, and destructive states remain visually distinct. The seven controls will stay on one row at phone width without wrapping or covering the message box.

## Cleanup

- Remove hands-free, rename, trash, and settings from the old chat header; keep the thread-list button, chat title, and close button there.
- Remove Image titles, Document titles, and Documents from the Attach section of Chat settings because those actions now live in the icon row.
- Keep Image to analyze in Chat settings because it was not requested for the new row.
- Replace the current wide Attach documents button above the message box with the paperclip icon in the new row.
- Keep selected document and image chips below the icon row so users can still see, open, and remove current attachments.
- Do not change any picker, rename, clear/delete, call, capability, attachment, or message behavior.

## Verification

- Check the open chat at phone and desktop sizes: all seven icons remain one row and the capability summary remains directly below it.
- Open every icon and confirm it reaches the same existing screen or confirmation.
- Confirm hands-free can start and stop, its spinner/live styling updates, and controls disable correctly without an active chat.
- Confirm attached-document count/selection, title insertion at the cursor, rename, clear, and delete still work.
- Run the project type check and confirm the preview build has no errors.
