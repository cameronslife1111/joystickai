# Attached documents in hands-free mode

Right now a hands-free call only gets the last few chat messages — the documents attached to the thread are invisible to Orby during the call. This makes attachments live for the whole call.

## What changes for the user

- Starting a hands-free call sends the full text of every document attached to that thread, so Orby can talk about them right away.
- While a call is live, the "Attach documents" button stays usable. Attaching a document mid-conversation makes Orby aware of it within a second or two, without dropping the call.
- Removing a document mid-call stops it from being sent — Orby no longer sees its contents for the rest of the conversation.
- A short confirmation appears when the live context updates (e.g. "Orby can now see 2 documents"), so it's clear the change took effect.
- If documents are very long, the newest attachments are included first and the context is trimmed to a safe size; the toast says so when trimming happens.

## Technical notes

- `src/lib/realtime.functions.ts`
  - Accept `documentIds: string[]` in the input schema alongside the existing `context`.
  - Add a shared helper that loads each attached document's title plus all of its sentences (paginated the same way `buildContext` in `src/lib/chat.functions.ts` does, so nothing is truncated at 1000 rows) using the auth-middleware `context.supabase` client, and formats it as `ATTACHED DOCUMENTS` blocks with a total character cap.
  - Include that block in the session `instructions`, with a line telling Orby it may reference these documents in conversation but still cannot edit them while the call is live.
  - Export a second auth-protected server fn `buildRealtimeDocContext({ documentIds })` that returns just the formatted block, for mid-call refreshes.

- `src/lib/use-realtime-voice.ts`
  - Keep a ref to the `oai-events` data channel.
  - Accept a `buildDocumentIds: () => string[]` option and pass the ids when minting the session.
  - Expose `updateContext(docBlock: string)` which, when the channel is open, sends a `session.update` event with regenerated `instructions` (call rules + recent conversation + the new document block). Store the call rules text in one place so client and server compose identical instructions — export the rules string from `realtime.functions.ts` and reuse it.
  - No-op safely when the call is idle.

- `src/components/ChatDialog.tsx`
  - Pass `buildDocumentIds: () => activeThread?.attached_document_ids ?? []` into `useRealtimeVoice`.
  - Stop disabling the attach-documents control during a live call (capability checkboxes stay disabled as they are today).
  - Add an effect keyed on the serialized `contextDocIds` that, while `voice.live`, calls `buildRealtimeDocContext` and then `voice.updateContext(...)`, then shows the confirmation toast. Guard against re-running on the initial mount of a call so the context isn't pushed twice.
