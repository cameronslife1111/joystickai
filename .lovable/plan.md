# Rebuild the homepage around the six-orb cluster

## The big picture

Replace the current bento-grid-of-squares landing page with a single vertical, scroll-driven story. The six small smiley orbs from the app's home screen (blue, purple, yellow, green, red, orange) become the stars: they float, drift, and react as you scroll, carrying the message "focus more in a busy world — one sentence at a time." The top-right Sign in button stays exactly where it is.

## New page structure (top to bottom)

```text
Nav (unchanged — Orby logo left, Sign in right)
─────────────────────────────────────────────
1. HERO — full screen. "Focus more in a busy world, one sentence at a
   time." Big headline, Get-started CTA. The six glowing smiley orbs
   float around the headline in a loose cluster, gently bobbing.
2. ONE SENTENCE AT A TIME — the signature animation: a single large
   sentence on screen that swaps to the next one as you scroll (or on a
   slow loop), with the previous sentence dissolving upward — visually
   proving "one sentence at a time." Small orbs drift past in the
   background.
3. MEET THE ORBS — the six-orbs cluster rendered large and centered
   (same arrangement as the app), each orb lighting up in sequence with
   a label: previous / next / menu / next document / delete / repeat.
4. MULTI-STEP PLANS — a plan building itself step by step as you scroll:
   each step line fades in and gets a colored orb dot as it "completes."
5. VOICE + MEDIA — short, calm section: talk to Orby, generate images
   and video mid-thought (no card grid — a single wide statement with a
   few drifting orbs and simple inline visuals).
6. FINAL CTA — "One sentence. Total focus." + Start free button,
   surrounded by the orb cluster.
Footer (unchanged content).
```

## Animation approach

- **Scroll-driven reveals**: each section's content fades/slides in as it enters the viewport (small `useReveal` hook using IntersectionObserver — no new dependencies).
- **Parallax orbs**: decorative orbs drift at different speeds as the user scrolls (translateY from a lightweight scroll listener, throttled via rAF). Orbs also idle-bob with the existing `glow-orb-pulse` animation plus a slow float keyframe.
- **Sentence cycler**: in section 2, one sentence at a time is shown large in the center; it crossfades/slides to the next sentence every ~2.5s (or tied to scroll progress within a sticky section). This is the hero "wow" moment.
- **Plan builder**: section 4 uses scroll progress to light up plan steps one at a time.
- Everything is disabled under `prefers-reduced-motion`.

## Reuse, not rebuild

- Use the existing `glow-orb-*` utilities from `src/styles.css` and the smiley SVG from `OrbCluster.tsx` (extract `Smiley` into a small shared component, or duplicate the tiny SVG into a new `LandingOrb` component so the app component stays untouched).
- Keep the current nav and Sign in link untouched.
- Keep the existing head metadata (title/description) with minor copy polish; add `og:type` and `twitter:card` to the index route head.

## Files to change

- `src/routes/index.tsx` — full rewrite of the landing page (delete bento grid, PlanStep, GestureRow).
- `src/components/LandingOrb.tsx` (new) — decorative glow orb with smiley, size/color props.
- `src/hooks/use-reveal.ts` (new) — IntersectionObserver reveal hook.
- `src/styles.css` — add landing-only keyframes (slow float, sentence swap, step pulse) and any small landing utilities.

## Details

- Copy leans into the user's language: "Focus more in a busy world. One sentence at a time." plus multi-step planning and voice-first messaging.
- Mobile-first: the vertical flow works at phone width first; desktop just widens it. No grids of cards anywhere.
- Dark space theme preserved (#020617 base with cyan/violet aurora glows).

## Verification

- Build log clean.
- Playwright pass at desktop (1280px) and mobile (390px) widths: screenshot each section, confirm orbs render with smileys, sentence cycler animates, Sign in still links to /auth, no console errors, reduced-motion respected.
