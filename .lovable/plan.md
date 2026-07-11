## Problem

When documents are attached to a chat, the AI only receives the **beginning** of each document, and the document content is placed in the wrong spot in the prompt.

Two root causes in `src/lib/chat.functions.ts`:

1. **Truncation ("only the beginning part").** `buildContext` fetches sentences with no explicit row range. The backend Data API caps unranged queries at ~1000 rows, so any longer document is silently cut off after its first ~1000 sentences.
2. **Wrong placement.** The document text is injected into the `system` prompt (the very start of the request). You want the attached documents appended **last** — after whatever the user typed in the text area.

Good news: freshness is already correct. The client only sends the attached document **IDs**, and the server pulls the document content from the database at the moment the message is sent. So if the user edits a document and then sends a new chat message, the updated content is already what gets pulled — we just need to stop truncating it and move it to the end.

## Changes (single file: `src/lib/chat.functions.ts`)

### 1. Pull the complete document, no truncation
Update `buildContext` so the sentences query returns every row, not just the first page:
- Paginate the `sentences` query in batches (e.g. `.range()` in a loop) until all rows for the document are fetched, then join in `order_index` order.
- This guarantees the full document — start to finish — is included regardless of length.

### 2. Attach documents last, after the user's text
Stop putting the document context in the `system` prompt. Instead:
- Keep `system` as just Orby's persona/instructions (plus a short note that reference documents are appended to the user's latest message).
- Build the outgoing `messages` so the **latest user message** becomes:
  ```
  <what the user typed>

  [Attached documents — treat as authoritative reference]
  [document: "Title A"]
  ...full content...

  [document: "Title B"]
  ...full content...
  ```
- Apply this in all three paths that use context: the normal chat route, the web-search route, and the image-analysis (vision) route — so documents are always appended last, on every send.

### 3. Keep it pulling fresh every time
No change needed to the client — it already passes `contextDocumentIds` and the server fetches at send time. We simply confirm the appended block is rebuilt on each `handleSend`, so an edited document is reflected the next time the user sends a message while it's still attached.

## Verification
- Attach a long document (>1000 sentences) and ask the AI to summarize the ending — confirm it references late content, proving no truncation.
- Ask the AI to repeat the last sentence of an attached doc — confirm it's the true last sentence.
- Edit a document, return to chat, send a new message with it still attached — confirm the AI sees the updated text.
- Confirm the user's typed question still comes first and documents follow after it.
