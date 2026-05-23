## Update sentence font to Poppins and make it noticeably bigger

### Overview
Replace the current "Instrument Serif" font with Poppins (a geometric, friendly, highly readable sans-serif) for all sentence display and edit mode text. Bump text sizes up two steps for a more comfortable reading experience.

### Changes

**1. `src/routes/__root.tsx`** — Update Google Fonts link
- Replace `Instrument Serif` with `Poppins` (weights 400, 500, 600, 700)
- Keep `Inter` for UI/body text

**2. `src/styles.css`** — Update font-display token
- Change `--font-display` from `"Instrument Serif", ui-serif, Georgia, serif` to `"Poppins", ui-sans-serif, system-ui, sans-serif`

**3. `src/routes/_authenticated/app.tsx`** — Bump sentence text sizes
- **Orb sentence display** (the main view as the user navigates sentences): change `text-3xl md:text-4xl` → `text-5xl md:text-6xl`
- **Edit mode textarea**: change `text-2xl md:text-3xl` → `text-4xl md:text-5xl`

### Why Poppins?
Geometric sans-serif with soft, rounded letterforms. Playful personality without sacrificing readability — ideal for an app where the user spends time reading one sentence at a time. It pairs cleanly with Inter for UI labels.

### Size rationale
Two full Tailwind steps up makes the text comfortably larger without overwhelming the orb-centered layout. The sentence is the sole focal point of the screen, so giving it more presence improves the reading experience.