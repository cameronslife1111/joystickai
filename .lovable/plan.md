# Reflex-speed virtual computer

Today the virtual computer hands the whole errand to a hosted browser robot that thinks with a big model before every single click — that is where the 10–15 seconds per click goes. This update gives Orby her own hands: she opens a throwaway cloud browser, looks at the page's clickable parts as plain text, and asks the instant decision engine (Jev) "which one do I press next?" That answer comes back in a fraction of a second, so she moves at human-reflex speed. The big model is used only twice — once at the start to set the strategy, once at the end to write the answer — plus whenever she gets stuck.

Your own TypeSafe key will be used, billed to your TypeSafe account. Once you approve, I'll open the secure form to save it (as `TYPESAFE_API_KEY`) and Orby will call TypeSafe directly with it.

## What you'll see

- Same 🖥️ Virtual Computer toggle, same card in chat, same Watch it work window, same Stop button, same locked box for passwords and texted codes.
- The card now shows a fast-moving plain-language ticker: "Opening distrokid.com", "Typing your email", "Pressing Sign in", "Opening the statement".
- Errands that used to take several minutes finish in well under a minute on ordinary sites.
- If a page confuses her (a puzzle, an unexpected wall, an odd layout), she quietly hands that same browser window to the old slower robot and keeps going — you just see the ticker slow down, never an error.
- Same safety rails: 8-minute ceiling, spend ceiling, one machine per person, machine always shut down at the end, passwords typed straight into the page and never shown to any model.

## How it works technically

### Steering loop (new)

- `POST /api/v4/browsers` creates a standalone cloud browser ($0.02/hr) and returns `cdpUrl` + `liveUrl` + id. Orby drives it herself over a Chrome DevTools Protocol WebSocket opened from the server (`fetch` with `Upgrade: websocket`, supported on the Worker runtime), a short burst per invocation — no long-lived socket.
- Each burst (up to ~6 actions, ~10s): `Runtime.evaluate` harvests a compact interactive-element list (tag, role, visible label, placeholder, href, value, centre coordinates — capped at ~120 candidates) plus page url, title and a short text digest. No screenshots, no vision model.
- One Jev request per action tick to `POST /v1/systemone` (`typesafe/jev-latest`, verified available on the gateway) with: a `choice` over the candidate elements crossed with verbs (`click`, `type`, `scroll`, `back`, `navigate`, `finish`, `escalate`), a `noul` for "goal already satisfied by the visible evidence", and a `noul` for "blocked by a login/verification/puzzle wall". Read `.choice`, `.probabilities[choice]` and `.confidence`.
- Action executed via `Input.dispatchMouseEvent` / `Input.insertText` / `Page.navigate`. Stored credentials are decrypted server-side and typed with `Input.insertText` directly — the value never enters Jev state, chat, logs, or any model prompt.
- Progress line written from the chosen action in plain user language.

### Strategy and escalation

- One strategist call at the start (existing `VC_MODEL`) turns the errand into 3–6 short sub-goals stored on the run; one call at the end turns the final page text into the chat answer.
- Escalate to the existing hosted-agent path when: choice confidence below threshold, blocked-noul high, the same page state repeats 3 times, or CDP fails. Escalation reuses the same browser session/profile, flips the run to `mode = 'agent'`, and the current `pollVcRun` loop takes over unchanged — so worst case is today's behaviour, never a failure.
- Needing a password still stops the run into `awaiting_secret` with the same locked-box card, then resumes reflex mode in the same window.

### Files

- New `src/lib/jev.server.ts` — one `askJev(state, questions)` helper over the gateway, with the documented error semantics surfaced to the card.
- New `src/lib/vc-reflex.server.ts` — browser creation, CDP burst driver, DOM harvest script, action execution, escalation handoff.
- `src/lib/vc.server.ts` — route new runs to reflex mode, keep every existing cap, shutdown, retry and secret path; add reflex action ceiling (~120 actions).
- Migration on `vc_runs`: `mode`, `cdp_url`, `action_count`, `actions` (jsonb log), `sub_goals`, `escalated_at`. No new tables; existing owner-only RLS and grants apply.
- `src/components/VirtualComputerCard.tsx` — reflex chip, action ticker, faster poke while a reflex run is live.

### Verification before I call it done

Typecheck and build; a real reflex run on a public site (open a page, pull out a fact, post it to chat) confirming the live window appears, the ticker moves, the answer lands and the machine is shut down; a deliberately confusing target to confirm the quiet handoff to the old robot; and a timeout run to confirm self-shutdown.
