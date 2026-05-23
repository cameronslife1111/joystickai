## Problem

In the **🔍 Search docs** overlay, the initial (unfiltered) list shows document titles vertically clipped — only the middle horizontal slice of each title is visible. As soon as the user types and the result list shrinks, rows render at their normal height.

## Root cause

In `src/routes/_authenticated/app.tsx` (~line 1966–1977), the results list is:

```text
<div class="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
  <button class="w-full truncate rounded-xl ... px-4 py-3 ...">
```

Flex children in a column default to `min-height: auto` but **can still shrink** when the total content exceeds the container. With many docs, each button is being compressed vertically by the flex layout, which clips the text. `truncate` adds `overflow: hidden`, hiding the clipped portion. When the list filters down to a few items, there's no overflow pressure, so heights look correct.

This is the exact same bug previously fixed for the "Send to" and document picker lists by adding `shrink-0`.

## Fix

Add `shrink-0` to the result button so each row keeps its natural height regardless of how many items are in the scrollable list. The parent already handles overflow via `overflow-y-auto`.

Change (single line, ~line 1973):

```text
className="w-full truncate rounded-xl border ... px-4 py-3 ... hover:bg-foreground/10"
```

to:

```text
className="w-full shrink-0 truncate rounded-xl border ... px-4 py-3 ... hover:bg-foreground/10"
```

No other changes needed. Filter behavior, keyboard handling, and styling stay identical.

## Verification

- Open the app, tap 🔍 Search docs with the full document list → every row renders at full height, scroll works.
- Type to filter → still renders correctly.
- Check on mobile viewport too.
