## Goal
Chat replies should be plain text only: no `**bold**`, no `#` headings, no `-`/`*` bullets. Numbered lists, emojis, punctuation, and blank lines between paragraphs stay allowed. This must apply to every chat thread, including replies already saved.

## Approach (two layers)

**1. Tell the model (prevention)**
In `src/lib/chat.functions.ts`:
- Replace the "light markdown formatting" line in the main chat system prompt with an explicit plain-text contract: never use asterisks, underscores, backticks, `#` headings, or bullet characters; use numbered lists (`1.`) when a list helps; separate paragraphs with a blank line; always use normal punctuation; emojis are fine.
- Apply the same rule to the web-search system prompt sent to Perplexity (it currently says "light markdown … occasional bold").

**2. Strip it anyway (guarantee)**
New helper `src/lib/plain-text.ts` exporting `toPlainText(text)`:
- Remove bold/italic markers (`**`, `__`, `*`, `_`) around words while keeping the words.
- Strip leading `#` heading markers and leading bullet markers (`-`, `*`, `•`, `+`) at line start, keeping the line's text.
- Strip backticks / code fences.
- Preserve `1.` numbered list prefixes, emojis, punctuation, and blank lines; collapse 3+ blank lines to one.

Apply it in both places so old and new messages are clean:
- Server: run every returned reply through `toPlainText` in `sendChatMessage` (chat, vision, and web-search paths) so newly saved messages are stored clean.
- Client: in `src/components/ChatDialog.tsx`, render assistant bubbles as `toPlainText(m.content)` (the message text render around line 817, assistant-only) so already-stored replies with `**` display as plain text too, plus the copy/insert-to-doc and speak paths use the cleaned text.

## Notes
- User messages are left untouched.
- No database migration and no changes to plan/step summary cards unless you want those cleaned too — say the word and I'll include them.
