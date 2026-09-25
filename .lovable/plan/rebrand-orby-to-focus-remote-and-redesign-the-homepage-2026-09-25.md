# Rebrand Orby to Focus Remote and redesign the homepage

All buttons, actions and features stay exactly as they are. Only names, words and the public homepage change.

## What changes
1. **Homepage**: rebuilt as a calm remote-control story. It covers:
   - "Focus Remote"
   - "Control the flow of your focus."
   - Supporting copy
   - "Start using Focus Remote" and "Sign in" buttons
   - A drawing of the real main screen: the sentence in the middle, the down arrow and the six colored buttons (no orbs, no faces)
   - One-step-at-a-time reading
   - Read, edit, capture ideas, link chats
   - Who it's for
   - Four benefits (your suggested copy)
   - A final call to action
   It works on phone, tablet and desktop. Sign in stays top-right.
2. **Sign-in and sign-up page**: Focus Remote wording. The orb picture is swapped for a small drawing of the remote. How sign-in works does not change.
3. **Browser tab titles and link previews** on every page: Focus Remote. The old preview image showed Orby, so it will be removed. Hosting will show a current screenshot instead.
4. **The assistant is called "Remote"** everywhere you see it: chat labels, "thinking…" messages, plan cards, schedules, virtual computer, connection panel and toasts. Its instructions are updated so it calls itself Remote. Its abilities stay the same.
5. **Welcome document for new accounts**: renamed to "🏆 Welcome to Focus Remote", with Orby changed to Focus Remote or Remote in the text. Welcome documents in existing accounts are not touched.
6. **Error and "not found" pages, download file names, and the Mac bridge install/pair screens**: visible wording only.

## Left untouched on purpose
Database, stored data, sign-in logic, web addresses, AI providers and models, plans, scheduling, background job, billing and locks, permissions, storage keys, and internal code names (for example the `Orb` component and `orby-*` identifiers). Internal names only show up in code, so they stay to avoid breaking anything.

## Technical details
- Files: `src/routes/index.tsx`, `auth.tsx`, `__root.tsx`, `_authenticated/app.tsx`, `_authenticated/media.tsx`, `src/lib/welcome-document.ts`, `assistant-instructions.ts`, `delegate-prompt.ts`, `chat-core.server.ts`, the visible strings in the components listed by `rg -i orby`, `src/lib/error-page.ts`, `mcp-bridge/install.ts` and `pair.ts` (text only), and the prompt text in `supabase/functions/plan-*` and `_shared/tools.ts`. Those three plan functions will be redeployed.
- New `RemotePreview` component: a static mockup built from the existing `glow-orb-*` button classes and the sentence card.
- Remove og:image and twitter:image from `__root`.
- Audit: run `rg -i "orby|orbi|orbee"` over the visible strings. Then check the build, the speech tests, and Playwright screenshots of `/` and `/auth` at 390px and 1280px wide.
- Update the landing-page memory so it describes the remote-style homepage.
