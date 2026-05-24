## Goal
Remove the "Insert here" button that sits between "Cancel" and "Send to…" in the compose action bar of the main app screen.

## Location
`src/routes/_authenticated/app.tsx` — lines 1586–1600 (the `<button>` with label "Insert here").

## Change
Delete the entire "Insert here" `<button>` element, leaving only "Cancel" and "Send to…" in the flex row.

## Verification
- The compose action bar renders two buttons: Cancel and Send to…
- No TypeScript or build errors.