# Note button: insert document text with blank lines between sentences

## What you'll see

Tapping the note button in chat and picking a document still adds the document's full text to the message box, but now each sentence starts on its own line with a blank line between sentences — matching how it appears in the document reader.

## How it works technically

In `src/components/ChatDialog.tsx`, inside `insertDocTextAtCursor`, change the sentence joiner from a single space to double newlines:

```ts
const body = (data ?? [])
  .map((s) => (s.content ?? "").trim())
  .filter(Boolean)
  .join("\n\n");
```

The existing multi-document joiner (`blocks.join("\n\n")`) stays the same, so each selected document's sentences are individually spaced and documents are still separated by a blank line.

No other behavior changes: empty documents still show the "That document has no text yet" toast, and the cursor-splice logic remains identical.

## Verification

Open a chat, tap the note icon, pick a document with several sentences, and press Done: the message box shows each sentence on its own line with a blank line between them.
