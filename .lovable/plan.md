# Make MacBook trackpad swipes reliable

## What I found

The desktop path in `src/hooks/use-orb-gestures.ts` listens for `wheel` events globally, adds their deltas, fires at a fixed threshold, and then ignores everything for 450 ms. It has no explicit end-of-gesture reset. On a MacBook, one physical trackpad swipe produces a momentum stream that can continue past that cooldown, so the tail of the old swipe and the start of the next swipe are not reliably separated. The listener is also passive, which prevents the app from claiming an intentional horizontal swipe before Chrome or Safari treats it as native scrolling/navigation.

The arrow-key path is separate and works correctly, so it will remain unchanged.

## Fix

1. Replace the fixed wheel cooldown with a small gesture-session state machine:
   - normalize pixel/line/page wheel deltas;
   - accumulate movement and lock to the dominant axis;
   - fire exactly once when the threshold is crossed;
   - end and fully reset the session after a short quiet period, including macOS momentum tails;
   - allow the very next deliberate trackpad swipe to start a fresh session.
2. Attach the wheel listener as non-passive and prevent the browser default only once the movement is recognized as an intentional Orb gesture. This keeps ordinary page behavior intact while avoiding Chrome/Safari history-navigation interference.
3. Preserve the existing gesture meanings, overlay/editing guard, pointer-drag gestures, and all four arrow-key shortcuts.
4. Verify repeated synthetic Mac-style wheel bursts in both axes, including momentum tails and short pauses, then check the live app in desktop Chrome for multiple consecutive swipes and unchanged keyboard behavior. The implementation will use browser-standard wheel handling shared by Chrome and Safari.

## Files to change

- `src/hooks/use-orb-gestures.ts`
- A focused gesture test file if the project’s current test setup supports it

## Out of scope

No changes to gesture meanings, speech behavior, Orb visuals, or mobile touch gestures.
