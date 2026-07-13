## Goal

Three changes to Orby's chat:
1. Long-pressing the orb should **open the chat you were last on** — never auto-create a new chat.
2. New chats are created **only** via the ☰ menu → New button.
3. After the first message in a chat, **auto-generate a short AI title** so threads aren't all named "Chat".
4. Upgrade the chat model to **GPT-5.6 SOL** using the existing OpenAI key.
5. Verify attached documents are sent to the AI in full on every send.

## Changes

### 1. Long-press → last chat, no new chat (`src/components/ChatDialog.tsx`)
- Persist the active thread id to `localStorage` (`orby_last_thread`) whenever it changes.
- On open, the bootstrap picks: `openThreadId` → the saved last thread (if it still exists) → the most recently updated existing thread. It only creates a thread when the user has **zero** threads (first-ever use).
- Long-press in `app.tsx` already just calls `setChatOpen(true)`; no change needed there — it will now land on the remembered thread.

### 2. New chat only from the menu (`src/components/ChatDialog.tsx`)
- Keep the existing ☰ drawer "New" button (`handleNewThread`) as the only creation path. No other flow creates threads.

### 3. Auto-name the thread after the first message
- Add a lightweight server function `generateThreadTitle` in `src/lib/chat.functions.ts` that takes the first user message and returns a short (2–5 word) title, using the same OpenAI provider/key.
- In `handleSend` (ChatDialog), after a successful first exchange in a thread whose title is still the default ("Chat" / "New chat"), call it and `updateThread` with the generated title. Runs in the background so it never blocks the reply.

### 4. Upgrade model to GPT-5.6 SOL (`src/lib/chat.functions.ts`)
- Change the model string from `gpt-5.5` to the GPT-5.6 SOL identifier (`gpt-5.6-sol`), keeping `createOpenAiProvider` + `OPENAI_API_KEY` exactly as-is. Since this calls OpenAI directly with your key, if OpenAI returns an "unknown model" error I'll correct the exact id and re-test.
- Use the same model for the new title-generation call.

### 5. Verify attached-document sending
- Confirm the already-implemented flow in `buildContext` (paginated full-document fetch) and the append-documents-after-the-user-message logic still fire on every send, across the normal, web-search, and image routes. Fix only if a gap is found — no rework of working code.

## Technical notes
- `src/lib/ai-gateway.ts` and `OPENAI_API_KEY` are unchanged; only the model string changes.
- Title generation is a separate short OpenAI call, kept off the critical reply path.
- Last-thread persistence uses `localStorage`, read in an effect (SSR-safe).
