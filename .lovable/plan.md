# Rebuild plan for the Send to feature

## Goal
Make Send to behave like a simple paste operation:
- **Top** inserts the new idea above everything else
- **Bottom** appends the new idea to the end only
- **Current** inserts the new idea immediately after the sentence the user is on
- Existing sentence order must never be flipped or scrambled
- Opening the destination picker on mobile must not trigger the keyboard

## What I will change

### 1. Fix the insertion logic at the source
Replace the current database insertion routine with a simpler, deterministic version that preserves existing order.

- Keep the current document rows in their original sequence
- Shift only the rows at or after the insertion point
- Insert the new sentences as one contiguous block
- Add explicit code comments stating that existing sentence order must never be reversed, re-ranked globally, or rewritten beyond the minimum required shift

### 2. Tighten the Send to UI flow
Simplify the send flow in the app screen so it matches the product behavior exactly.

- **Top**: insert at index `0`
- **Bottom**: insert at `current length`
- **Current**: insert at `current sentence index + 1`
- Keep the optional sentence picker only as a precise anchor selection path if it is still needed, but ensure the default “current” action uses the user’s actual current sentence directly
- Add guard comments in the send code so future changes do not reintroduce reorder logic

### 3. Stop the mobile keyboard from opening during send destination selection
The keyboard is appearing because the compose textarea remains focused while the send overlay is opened.

I will:
- blur the compose textarea before opening the send sheet
- keep the send overlay as button-only selection UI with no auto-focused inputs
- preserve typing when the user returns to composing, without auto-triggering the keyboard during destination selection

### 4. Validate every write path that touches sentence order
Review the other sentence mutation paths so they stay compatible with the new ordering rules.

- AI insert path
- delete/undo path
- full document edit save path
- any optimistic cache updates for sentence order

This is to ensure there is one consistent ordering model everywhere.

## Technical details
- **Primary frontend file:** `src/routes/_authenticated/app.tsx`
- **Primary backend change:** replace the current `insert_sentences_at(...)` migration logic with a corrected migration that preserves stable order
- **Why the bug happens now:** the existing function temporarily negates every `order_index` and then ranks rows by that temporary value, which reverses the effective sequence and can make “send to bottom” reorder the document
- **Keyboard issue:** the compose textarea is auto-focused and remains active when the send overlay opens, so mobile Safari brings the keyboard up even though the overlay only needs button taps

## Expected result
- Send to Top, Bottom, and Current behave like simple paste operations
- Existing sentences keep their original order
- The selected/new idea text is inserted as one intact block
- The destination picker does not open the keyboard on iPhone/mobile
- The code contains clear guard comments so future edits do not reintroduce sentence reordering