# Getting Orby ready for testers

Three things: prove accounts can't see each other's data, lock the three heavy features for brand-new accounts, and give every new person a friendly help document as their first list.

## 1. No data leaking between accounts

Every table already limits rows to the signed-in owner, so this is a verification pass plus tightening anything the check turns up:

- Re-check owner rules and permissions on all tables, including the newer ones (chats, plans, schedules, virtual computer, media folders).
- Re-check every backend action that runs with elevated rights (chat replies, plan runner, schedules, virtual computer, the Resolve helper) and confirm each one filters to the owner of the row it's working on.
- Live test: sign in as a second test account and confirm it sees zero documents, sentences, chats, plans and gallery items from the first account, and that opening another account's item by its id is refused.
- Anything that fails these checks gets fixed in this same change.

Note on gallery files: image and video files stay in the current open file area, as you chose. Links are long random paths and aren't listed anywhere, but someone who was handed a link could open it without signing in.

## 2. Lock virtual computer, video generation and video-to-video for new accounts

Locked for any account created from the moment this ships; every account that already exists keeps everything exactly as it is now.

- The two chat switches (Virtual Computer, Video generation) don't appear at all for locked accounts, and are treated as off even if an old chat had them on.
- The gallery's video buttons (photo to video, video to video, photo + sound to video) are hidden for locked accounts.
- Orby also won't plan or run those actions for a locked account, so a request like "make me a video" gets a plain reply instead of a half-finished plan.
- One switch in the code unlocks everything again when you're ready — flip it and locked accounts get the features back with no other edits.

## 3. The Orby welcome & help document

Created automatically the first time someone signs in, as their only starting document (replacing the current "My first list"), and it stays theirs to keep, edit or delete.

First sentence, exactly: `Welcome to Orby. Press the purple down arrow button.`

Then one short sentence per idea, in this order:

- How documents work: everything is split into sentences, and you move through them one at a time.
- Each button, one sentence each, with a second sentence for its hold action where it has one: purple (next sentence / hand the sentence to Orby), blue (previous sentence / lock the list), red (search your documents / recent documents), yellow (menu / new idea), pink (move this sentence / jump to), green (next document / link this sentence), orange (open your pinned document / pick what's pinned), grey (gallery / chat).
- Tapping the sentence itself to edit it, and holding it to talk instead of typing.
- Orby chat: what it is, and that a request becomes a step-by-step plan you approve before anything happens.
- One or two sentences per chat capability: planning, document editing, image generation, video generation, scheduling, web search, image analysis, DaVinci Resolve mode, virtual computer.
- A closing sentence saying this document is always here whenever they need a reminder.

Video generation and virtual computer are still described, with a short note that they're switched off for now.

## Technical notes

- `src/lib/feature-lock.ts`: exports the cutoff timestamp, a master `UNLOCK_ALL` flag, the locked capability keys (`virtual_computer`, `video_generation`) and `isFeatureLocked(userCreatedAt)`. Client reads `user.created_at` from the current session once (in `app.tsx`) and passes it down; `ChatDialog.tsx` filters `CAP_LABELS` and forces those keys false in `DEFAULT_CAPS`/normalisation, `media.tsx` hides the three video dialogs' entry points.
- Server side: a small `feature-lock.server.ts` resolves the owner's `created_at` through the admin auth API (cached per request) and strips locked capability keys in `chat-turn.server.ts` and `schedule-fire.server.ts` before the model/plan sees them, so plan compose can't emit `image_to_video`, `video_to_video`, `audio_image_to_video` or `virtual_computer_task` for a locked account.
- Welcome document: replaces the bootstrap insert at `src/routes/_authenticated/app.tsx:461-476`. Content lives in a new `src/lib/welcome-document.ts` as an ordered string array; sentences are written with `insert_sentences_at` so ordering stays dense. Guarded so it only runs when the account has no documents at all.
- Isolation pass: `supabase--linter` plus a Playwright run against localhost with a second minted account, asserting empty lists and a refused cross-account fetch. Reviewed alongside: the public tick endpoints (`plan-tick`, `media-poll-tick`, `plan-scheduler-tick`) accept the public key — they only advance work for the row's own owner, and I'll confirm no response body carries another account's content.
- Verify with `bunx tsgo --noEmit`, `bun test`, and a clean build log.
