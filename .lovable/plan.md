## Plan: Auto-swipe-right after Jump to Top

### Goal
After the user selects "Jump to top" from the Jump-to overlay, automatically perform a swipe-right action to advance to the next favorite document. This saves the user from having to manually swipe right after jumping to the top.

### Changes

#### 1. `src/routes/_authenticated/app.tsx` — modify `jumpTo` function

The `jumpTo` callback (line 463) currently:
1. Sets the sentence index
2. Speaks the sentence
3. Closes the jump overlay (`setJumpOpen(false)`)

Add a step: after `setJumpOpen(false)` and only when `target === 0` (i.e. "jump to top"), call `onSwipeRight()` to advance to the next document.

```text
Before:
  await setIndex(clamped);
  speak(sentences[clamped].content, token);
  setJumpOpen(false);

After:
  await setIndex(clamped);
  speak(sentences[clamped].content, token);
  setJumpOpen(false);
  if (clamped === 0) {
    // Small delay so the "top" speech isn't immediately cut off by doc-switch speech
    await new Promise((r) => setTimeout(r, 600));
    await onSwipeRight();
  }
```

The `onSwipeRight` callback already claims its own speech token and handles all doc-switching logic (linked docs, favorites cycle, all-docs fallback), so this simply delegates to it.

The `jumpTo` dependency array will need `onSwipeRight` added.

### No other files touched.
- No backend, schema, or data changes.
- No UI changes — the flow is identical except the auto-advance happens after the jump overlay closes.