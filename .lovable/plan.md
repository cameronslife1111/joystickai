# Combine Gen text / Analyze image / Web search into one Chat

Replace menu slots 13 (✨ Gen text), 14 (👁️ Analyze img), and 15 (🌐 Web search) with a single **💬 Chat** button in slot 13. It opens a full chat view with message bubbles, settings, attachments, and per-message actions. History is saved to the user's account.

## What the user gets

- One **Chat** button (slot 13). Slots 14 and 15 become empty.
- A chat view with user/assistant bubbles.
- A **Settings** button (gear) opening a popover with:
  - **Clear chat** (wipes saved history)
  - **Attach** image (from media gallery)
  - Toggle **Web search** on/off
  - Toggle **Analyze image** on/off
- An **attach-document dropdown** directly above the text input — picks documents used as context, and (when Analyze image is on) also lets you pick an image to send.
- Under each bubble: a **Play** button (Web Speech reads the bubble; tap again cancels) and a **Copy** button.
- Under each assistant bubble: an **Insert into document** action (choose target doc + position), reusing the existing destination picker.
- Conversation persists across sessions/devices until cleared.

## Behavior of the toggles

- **Default (both off):** normal Orby chat reply.
- **Web search on:** the message is answered using Perplexity (current/live info).
- **Analyze image on:** if an image is attached, Orby looks at the image when replying; the dropdown surfaces an image picker.
- Attached documents are always passed as context.

## Data model

New table `chat_messages` for a single per-user conversation:

```text
chat_messages
  id          uuid pk default gen_random_uuid()
  user_id     uuid not null
  role        text not null   -- 'user' | 'assistant'
  content     text not null
  created_at  timestamptz not null default now()
```

- Enable RLS; policies scoped to `auth.uid() = user_id` (select/insert/delete).
- Grants: `authenticated` (select/insert/delete), `service_role` all.
- "Clear chat" = delete all rows for the user.

## Server function

New `src/lib/chat.functions.ts` (`createServerFn`, `requireSupabaseAuth`):

- `sendChatMessage({ messages, contextDocumentIds, imageUrl?, webSearch, analyzeImage })`
  - Loads attached documents' sentences as context text.
  - Routing:
    - `webSearch` → Perplexity `/v1/agent` (same pattern as `webSearchForCall`), conversational plain-text output.
    - `analyzeImage` + `imageUrl` → OpenAI multimodal (text + image), like `analyzeImage` in `ai.functions.ts`.
    - else → OpenAI chat with full message history (like `chatWithOrby`).
  - Returns `{ text }`. Replies are conversational prose (markdown rendered client-side).
- Persistence of the user message + assistant reply is done client-side via the browser Supabase client (RLS-scoped) so history is saved to the account.

## UI

New `src/components/ChatDialog.tsx` (full-height dialog/sheet):

- Loads history with TanStack Query (`["chat_messages", userId]`) ordered by `created_at`.
- Bubbles: user messages as a filled high-contrast bubble (right); assistant messages plain on the surface (left), rendered with `react-markdown` (already used in app per chatbot guidance — add if missing).
- Optimistic user bubble + "Thinking…" indicator while awaiting the reply.
- Settings popover (`@/components/ui/popover`): Clear chat, Attach image, Web search switch, Analyze image switch (`@/components/ui/switch`).
- Above the textarea: a documents dropdown (reuse `DocumentPickerSheet` trigger + chips, matching existing dialogs) and, when Analyze image is on, an image picker (`MediaGalleryPicker`).
- Per-bubble action row: Play/Stop (Web Speech via `SpeechSynthesisUtterance`, stripping emoji like the existing mute handler; track the speaking message id to toggle cancel), Copy (existing `copyToClipboard`), and for assistant bubbles an Insert button opening `DestinationPicker` to write the reply into a document.
- Keep the textarea focused on open and after sending.

## app.tsx wiring

- Remove the three menu grid entries for Gen text / Analyze img / Web search and their dialogs/state/imports (`GenerateTextDialog`, `AnalyzeImageDialog`, `WebSearchDialog`), unless reused elsewhere (they aren't).
- Add `chatOpen` state, a single `{ e: "💬", t: "Chat", ... }` grid entry, and render `<ChatDialog>`.
- In the `slots` map: `filled[12] = <chat>`, `filled[13] = null`, `filled[14] = null`.

## Technical notes

- Reuses existing secrets: `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`. No new secrets.
- Migration includes table + RLS + grants in one file.
- Existing `chatWithOrby` (call mode) is untouched; this is a separate text-chat path.
