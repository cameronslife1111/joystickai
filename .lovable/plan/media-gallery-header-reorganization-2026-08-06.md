# Media Gallery Header Reorganization

## Goal
Rearrange the media gallery top header so the Generate button sits in the top action row (same size as Download All and Plus), and the page title is aligned to the left.

## Current State
- `src/routes/_authenticated/media.tsx` has a three-column header grid: left select button, centered title, right action buttons (Download All, Plus).
- The Generate button is currently a floating FAB near the bottom of the screen (`Sparkles` icon + "Generate" label).

## Changes

### 1. Move Generate into the header
- Remove the floating Generate FAB from the bottom of the page.
- Add a new circular icon button (`h-10 w-10 rounded-full`) in the right-side action group.
- Position it immediately to the left of the Download All button.
- Keep the same `Sparkles` icon and `setGenerateOpen(true)` behavior.

### 2. Left-align the title
- Move the header title ("Media Gallery" or the current folder name) to the left side of the header.
- Keep it readable and avoid overlap with the action buttons.
- Preserve the select-mode variant that shows the selected count.

### 3. Keep existing behavior
- Do not change the GenerateImageDialog logic or generation flow.
- Keep Download All and Plus buttons exactly as they are (only their neighbor changes).
- Keep the fixed-height full-screen layout and bottom Back button from the previous update.

## File
- `src/routes/_authenticated/media.tsx` (header section and floating FAB section)
