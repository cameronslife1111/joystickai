## Auto-repeat current sentence after 2 minutes of inactivity

Add a passive timer that re-speaks the user's current sentence every 2 minutes if they haven't navigated. The repeat must not affect Orby's mood (no color/emotion change), but the mouth will still animate because the existing lip-sync hook polls `window.speechSynthesis.speaking` independently.

### Behavior

- After the user lands on a sentence (any navigation: swipe, jump, favorite slot change, doc switch, send-to resume, link follow, etc.), start a 2-minute timer.
- When the timer fires:
  - If muted, the app is hidden (`document.hidden`), the user is currently editing, or any modal/compose flow is active, skip this tick and reschedule another 2 minutes.
  - Otherwise call `speak(currentSentence.content, claimSpeech())` and reschedule another 2 minutes.
- Any change to the "active sentence identity" — `activeDocId` or `currentIdx` — cancels the pending timer and starts a fresh 2-minute countdown for the new sentence. This guarantees a stale sentence can never be spoken: by the time the timer fires, the effect for the previous (docId, idx) pair has already been torn down.
- The repeat must NOT call `orbRef.current.boostMood()` and must NOT touch `useOrbMood` state. Mouth movement happens automatically via the existing `speechSynthesis.speaking` poll in `use-orb-mood.ts`.

### Implementation

Single file touched: `src/routes/_authenticated/app.tsx`.

Add one `useEffect` keyed on `[activeDocId, currentIdx, sentences, speak, claimSpeech, /* mute ref via mutedRef */]`:

```ts
useEffect(() => {
  const text = sentences?.[currentIdx]?.content;
  if (!text) return;
  const id = window.setTimeout(function tick() {
    // Guard: don't interrupt user activity / silent modes.
    if (mutedRef.current || document.hidden || editing || composeOpen /* etc */) {
      // Reschedule and bail.
      // (handled by restarting the timer below)
    } else {
      const token = claimSpeech();
      speak(text, token);
    }
  }, 2 * 60 * 1000);
  return () => window.clearTimeout(id);
}, [activeDocId, currentIdx, sentences, speak, claimSpeech, editing]);
```

Notes on the guard set: include `editing`, any "compose/menu/dialog open" booleans already in scope (e.g. `composeOpen`, `menuOpen`, `jumpOpen`, plan/media dialogs). If a guard trips, restart a fresh 2-minute timer rather than firing — easiest pattern: use `setInterval(2*60*1000)` and check guards inside, or recursive `setTimeout`. Either is fine as long as cleanup cancels both the timer and any speech this effect started (it won't, because re-reads only run when no other activity is happening, and any new navigation increments `speechTokenRef` via the next `claimSpeech()` call).

### Safety against stuck loops

- Effect cleanup (`clearTimeout`) runs synchronously whenever `activeDocId` or `currentIdx` changes, so a queued repeat for the old sentence is cancelled before it can fire.
- The fired repeat itself calls `claimSpeech()` which cancels any in-flight utterance and bumps the token, so even an in-flight stale utterance from a previous tick gets cut off the moment the user navigates and triggers a new `claimSpeech()`.
- Modal/edit/mute guards prevent repeating over the user's voice or in the background.

### Out of scope

- No change to `useOrbMood`, `Orb.tsx`, or any mood/color logic.
- No change to swipe gesture handling itself — the existing handlers already mutate `currentIdx`, which is what resets the timer.
- No persistence across reloads; on reload the 2-minute window simply restarts from the moment the user reaches a sentence.
