# Add document search to the Attach documents sheet

When the user opens the chat (slot 13), then taps **Attach documents** (from settings or the composer row), they get the `DocumentPickerSheet`. I'll add a search input at the top so they can filter documents by title before selecting. Multi-select already works and stays unchanged.

## Changes (`src/components/DocumentPickerSheet.tsx`)

1. Add a `query` state string and a search `Input` directly under the sheet header, with a placeholder like "Search documents…". Clear it whenever the sheet opens.
2. Derive a `filtered` list from `docs` by case-insensitive match of `query` against the document title.
3. Render `filtered` instead of `docs` in the list, and show a "No matches" empty state when a search yields nothing (keep the existing "No documents yet." state for when there are truly no docs).
4. Keep the Done button and selection behavior exactly as is — selecting/deselecting multiple documents continues to work, including documents that get filtered out (their selection is preserved).

## Notes

- Uses the existing `Input` component (`@/components/ui/input`); no backend or query changes.
- The search only filters the visible list; it does not affect which selected IDs are returned on Done.
