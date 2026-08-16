# Slot 15 Delegate: confirm it's a stale build, then make it verifiable

The new Delegate code is present in the project right now (verified by reading the files):

- `src/routes/_authenticated/app.tsx` — slot 15 is `🟣 Delegate`, and its handler only sets a payload (`documentId`, `title`, `index`) and opens the chat. No prompt is fired anymore.
- `src/components/ChatDialog.tsx` — on open with that payload it creates a fresh thread titled `Delegate: <title>`, attaches the document, calls the suggestions function, and renders the checkbox card.
- `src/components/DelegateSuggestionsCard.tsx` and `src/lib/delegate.functions.ts` — the card UI and the 5-suggestion server function exist.

So the old behavior you're seeing is coming from an older bundle being served to your phone, not from the code. What I have not verified is which build your phone loaded — that's the first step below.

## Steps

1. Drive the running preview in a headless browser: open a document, open the menu, tap slot 15, and capture what renders (fresh `Delegate:` thread, attached doc chip, checkbox card) plus any console/network errors from the suggestions call. This tells us definitively whether the code path works or fails at runtime.
2. If a runtime error shows up (auth on the server function, JSON parse of the model output, empty sentences), fix that specific failure.
3. If it works in preview, publish again so the live site serves this bundle, then confirm the published page's asset hash changed.
4. Add a small no-cache guard so an installed/home-screen copy of the app can't keep serving a stale bundle: on load, if the service-worker/cached HTML references a bundle that no longer exists, force a one-time reload. (Only if step 1/3 shows caching is the cause.)

## Notes

- No schema, plan-engine, or capability changes. Delegate still routes through the normal chat → plan-compose flow with all capabilities on after Approve.
- After publishing, a hard refresh on the phone (or removing and re-adding the home-screen icon) is the fastest way to drop the old bundle.
