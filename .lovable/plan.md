
# Joystick AI — Build Plan

A focus app where you see exactly **one sentence at a time** from a document, and control everything through a glowing orb in the center of the screen.

## Core interaction model (the orb)

The orb is the entire UI. All gestures work with both touch and mouse:

| Gesture | Action |
|---|---|
| Single tap/click | Advance to next sentence + speak it aloud (Web Speech API) |
| Swipe up (press + drag up) | Go back one sentence |
| Swipe down | Delete current sentence (with 5s undo toast at bottom) |
| Swipe right | Cycle to next document, jump to its remembered sentence |
| Swipe left | Open the grid menu |
| Double tap | Edit current sentence inline (cursor in place, Enter splits + saves) |
| Long press | Voice mode → transcribe → send to AI → insert AI sentences after current position |

Top of screen: small text showing the current document title.
Bottom: transient toasts (undo, status).

## Pages

1. **Landing page** (`/`) — playful colorful (not girly), explains "focus on one thing at a time in a busy world," animated orb hero, CTA to sign up.
2. **Login/Signup** (`/auth`) — email + password only, no email verification, joystick-themed visuals.
3. **App** (`/app`) — full-screen orb experience for the signed-in user.

## Data model (Supabase)

Tables, all with RLS scoped to `auth.uid()`:

- `documents` — `id`, `user_id`, `title`, `position` (cycle order), `current_sentence_index`, `created_at`, `updated_at`
- `sentences` — `id`, `document_id`, `user_id`, `content`, `order_index`, `created_at`
- `user_preferences` — `id`, `user_id`, `theme` (light/dark), `grid_layout` (jsonb: array of slot IDs in user-chosen order)

**Hard delete only.** When a user deletes a sentence or document, rows are removed from the DB (no `deleted_at` soft-delete column). Foreign keys use `ON DELETE CASCADE` so removing a user or document removes everything beneath it. Account deletion (later) wipes all rows.

RLS: every table — `USING (user_id = auth.uid())` for select/insert/update/delete. No public read.

## AI integration

- **TTS**: browser Web Speech API (`SpeechSynthesis`) — no backend needed.
- **STT**: browser Web Speech API (`SpeechRecognition`) for long-press transcription. Fallback note for unsupported browsers.
- **AI continuation**: Lovable AI Gateway via `createServerFn` (`google/gemini-3-flash-preview` default). Server function takes the transcript + the surrounding document context, returns plain text, which we split into sentences and insert after the current index.

(User mentioned OpenAI specifically — Lovable AI Gateway is the platform default and supports `openai/gpt-5` models too. I'll default to Gemini Flash for speed/cost; easy to switch.)

## Sentence splitting

A single utility (`splitIntoSentences`) using a regex that handles `.`, `!`, `?`, preserves common abbreviations, trims whitespace. Used in two places: AI responses, and Enter-to-split during edit mode.

## Grid menu (swipe left)

3 columns × 5 rows = 15 numbered slots. Each slot is an emoji + 1–2 word label. Initial slots:

1. 🌓 Theme (light/dark toggle)
2. ➕ New doc
3. ✏️ Rename
4. 🗑️ Delete doc
5. 🔀 Reorder grid (drag-to-rearrange mode)
6. 📋 Docs list (jump to any document)
7. 🚪 Sign out

Remaining slots empty placeholders for future: image gen, video gen, audio, MCP, call mode. Layout persisted in `user_preferences.grid_layout`.

## Gesture implementation

One custom hook `useOrbGestures` handles pointer events (`pointerdown`/`move`/`up`) — unifies mouse + touch. Detects:
- tap vs double-tap (300ms window)
- long-press (500ms threshold, cancels if movement > 10px)
- swipe direction (after threshold of 40px, snaps to nearest of 4 directions)

Returns callbacks: `onTap`, `onDoubleTap`, `onLongPressStart`, `onLongPressEnd`, `onSwipe(direction)`.

## Visual direction

- Glowing aurora orb: radial gradient + soft animated conic gradient inside, blurred shadow halo. Subtle idle pulse.
- Background: very dark (dark mode) or very light (light mode), single sentence in large, readable serif (e.g. Instrument Serif) centered above the orb.
- Accent palette: electric blue → violet → magenta aurora. Playful, not girly.
- Mobile-first layout, scales gracefully to desktop (orb caps at ~240px).

## Tech stack (already in template)

- TanStack Start + React + Tailwind v4
- Lovable Cloud (Supabase) — enable in first step
- AI SDK + Lovable AI Gateway for continuation
- Web Speech API for STT/TTS (browser-native, no extra deps)

## Build order

1. Enable Lovable Cloud.
2. Migrations: `documents`, `sentences`, `user_preferences` with RLS + cascade deletes.
3. Auth helpers + `/auth` page (email/password, no verification).
4. Landing page `/` with animated orb hero.
5. `_authenticated` layout route guarding `/app`.
6. `useOrbGestures` hook + `Orb` component (visual only).
7. Sentence splitter util + server fn `aiContinue`.
8. `/app` page wiring all gestures to data ops.
9. Grid menu overlay (swipe-left) with theme + doc management slots.
10. Inline edit mode + Enter-split logic.
11. Undo toast (5s) for sentence delete.
12. Polish: animations, transitions between sentences, orb state during long-press recording.

## Out of scope for this build (acknowledged for later)

- AI call mode on long-press of menu button
- Image/video/audio generation
- MCP connections
- Email verification, password reset, social auth

## Technical notes

- All gestures handled on a single orb element with `touch-action: none` to prevent browser scroll interference.
- `current_sentence_index` updated on every navigation (debounced 500ms to reduce writes).
- Optimistic UI for all sentence mutations; rollback on server error.
- Web Speech APIs are gracefully degraded — if unsupported, tap still advances (no speech), long-press shows a "voice not supported in this browser" toast.
- Hard deletes confirmed at SQL level via `DELETE` (no soft-delete pattern anywhere).
