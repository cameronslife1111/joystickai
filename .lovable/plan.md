## Problem

Sending a chat message with several attached documents fails Zod validation with "String must contain at most 12,000 characters". The 12k cap in `src/lib/chat.functions.ts` is far below what GPT-5.6 SOL supports (~400k-token context, roughly 1M+ characters of input).

## Change (single file: `src/lib/chat.functions.ts`)

Keep the model (`gpt-5.6-sol`) and everything else exactly as-is. Only raise the two string caps that block large attachments:

1. Line 9 — chat message `content`: `.max(12000)` → `.max(1_000_000)`
   - This is the per-message string that already contains the user's typed text plus the appended attached-document context built by `buildContext`.
2. Line 332 — `sendChatMessage` `message` input: `.max(4000)` → `.max(20_000)`
   - This is only the user's typed text (attachments are fetched server-side by id), so a generous 20k is plenty and keeps a sane guard.

Leave untouched: model id, `messages` array cap (60), `contextDocumentIds` cap (20), prompt construction, and everything outside these two `.max(...)` numbers.

## Why these numbers

GPT-5.6 SOL's context window is far larger than 12k characters; 1M chars for the fully-assembled message comfortably fits realistic multi-document attachments while still preventing a runaway payload. The typed-message cap stays small because attachments don't flow through it.

## Verification

- Typecheck passes.
- Send a chat message with multiple large documents attached — no more "String must contain at most 12000 characters" error.
