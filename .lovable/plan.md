# AI-created documents: visible in link picker + tappable links in chat

## Goal

1. A document created by a chat multi-step plan shows up immediately in the "Link this sentence" picker (and other doc lists).
2. Orby can hand you a document link inside the chat; tapping it closes the chat, opens that document, and starts reading it aloud exactly like opening it manually.

## Part 1 — freshness of document lists

Today the link picker is handed a snapshot of the documents list from the app screen. When a plan creates a document server-side, that snapshot can be stale, so the new document is invisible.

- `LinkDocumentDialog` loads its own fresh document list whenever it opens (own query, no stale cache), and falls back to the passed-in list while loading. Same treatment for the attach-documents sheet so its cached list refetches on open.
- When a plan finishes inside chat (and when the chat creates a document), refresh the documents lists so every picker sees the new doc.
- `goToDocument` in the app screen currently bails out if the target id isn't in its cached list. It will re-fetch the document once before giving up, so newly created documents can be opened.

## Part 2 — document links inside chat

- Orby's replies (and plan result summaries) may include a link token of the form `[[doc:<document-id>|Title]]`.
- Chat message rendering parses those tokens and renders a small tappable pill (📄 Title) instead of raw text.
- Tapping a pill closes the chat and opens that document through the existing open-document path, which restores the saved sentence position and triggers speech — same as manual navigation.
- Assistant instructions are updated so that whenever Orby creates a document (via `create_document` or a document-editing plan step), it ends its reply with the link token for that document. The `create_document` tool result already returns the id, so the model has what it needs.
- Belt-and-braces: when a plan run inside chat contains `create_document` steps, the finished plan card also lists those documents as the same tappable pills, so a link exists even if the model omits the token.

## Technical notes

- `src/components/LinkDocumentDialog.tsx`: add a `useQuery(["link_documents"], { enabled: open, staleTime: 0, refetchOnMount: "always" })` selecting `id, title` from `documents`; use its data when present, else the `documents` prop.
- `src/components/DocumentPickerSheet.tsx`: add `refetchOnMount: "always"`/`staleTime: 0` to `documents_with_counts`.
- New `src/components/DocLinkText.tsx`: parses `[[doc:uuid|Title]]` out of a string and renders text plus pill buttons; used by the chat bubble renderer (replacing the plain `whitespace-pre-wrap` span) and plan `result_summary`.
- `src/components/ChatDialog.tsx`: pass `onOpenDocument` down to the renderer; pill click calls `onOpenChange(false)` then `onOpenDocument(id)`; invalidate `["documents"]` and `["documents_with_counts"]` when a plan reaches a terminal state.
- `src/routes/_authenticated/app.tsx`: in `goToDocument`, if id not in `docs`, fetch that document row directly and continue when it exists (and invalidate `["documents"]`).
- `src/lib/assistant-instructions.ts` (and the plan summary prompt in the plan-compose/step path): document the `[[doc:<id>|Title]]` output convention for newly created or edited documents; keep replies otherwise plain text.

## Out of scope

- No database schema changes.
- No change to how plans execute or to capability checkboxes.
