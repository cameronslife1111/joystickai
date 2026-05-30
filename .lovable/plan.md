## Goal

Two small changes to the main reader (`src/routes/_authenticated/app.tsx`):

1. **Swipe right opens a linked document.** When the current sentence has a linked document, swiping right opens that linked document instead of cycling to the next favorite. If there's no linked document, swipe right keeps working exactly as it does today (favorites cycle, or all-docs fallback).
2. **Move the "linked" pill to the top.** The little link chip that currently floats above the orb moves up underneath the document title in the header.

## Change 1 — Swipe right opens linked doc

In `onSwipeRight` (starts line 619), add an early check right after the `lockFavorites` repeat block: if `currentSentence?.linked_document_id` points at a document that exists in `docs`, call the existing `openLinkedDocument()` and return. That function already handles everything correctly (resumes the linked doc at its saved sentence, primes caches, speaks). Everything below that check — the favorites cycle and the all-docs fallback — stays untouched and runs whenever there's no linked document.

Note: `openLinkedDocument` already claims its own speech token, so the early branch will simply delegate to it rather than duplicating logic.

## Change 2 — Move the linked pill under the title

- Remove the linked-document button that currently sits above the orb (lines ~1714–1727, the absolutely-positioned chip with `-top-10`).
- Re-add it inside the header (after the title/counter block, lines ~1520–1536), rendered as a small centered pill directly beneath the document title. It keeps the same look (link icon + linked doc title, primary accent) and the same tap behavior (`onClick={() => void openLinkedDocument()}`), just positioned in normal flow under the title instead of floating over the orb.

## Technical notes

- No backend, schema, or data changes. Pure frontend.
- The linked-doc tap, the swipe-right gesture, and the indicator now all funnel through the same `openLinkedDocument()` callback, so behavior stays consistent.
- Locked-favorites behavior: swiping right on a sentence with a linked doc will open the link (the link takes precedence over the "repeat current sentence" lock), matching the request that swipe right should always open a linked document when one exists.
