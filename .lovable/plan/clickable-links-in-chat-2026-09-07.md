# Clickable links in chat

Right now when Orby answers with web links, they show up as plain text you can't tap. This makes every link in a chat reply tappable, the way ChatGPT does it.

## What changes

- Any web address in a chat message becomes a tappable link that opens in a new tab (both `https://...` and bare `www.` style addresses).
- When Orby writes a link with a label (a title plus its address), the message shows the label as the tappable link instead of a long raw URL.
- Links get a clear underlined, colored style that stays readable inside both the blue (yours) and gray (Orby's) bubbles, and inside plan result summaries.
- Long addresses wrap instead of stretching the bubble off screen.
- Tapping a link never triggers the read-aloud or other bubble actions.
- Reading aloud and copying stay clean: speech says the link's label, not the raw address.
- Orby's instructions are updated so that when you ask for links it always returns real, complete web addresses (with labels), rather than bare site names.

## Technical notes

- `src/components/DocLinkText.tsx`: after splitting out the existing `[[doc:<id>|Title]]` pills, run each remaining text run through a link parser and render `<a target="_blank" rel="noopener noreferrer" onClick={stopPropagation}>` segments with `underline underline-offset-2 break-all` styling using existing tokens. Extend `stripDocLinks` (used for speech/copy) to also reduce markdown-style links to their label text.
- `src/lib/linkify.ts`: extend to also match markdown links `[label](url)` and bare `www.` hosts (prefix `https://` for the href, display the original text), keeping the existing trailing-punctuation trimming. Segment type gains an optional distinct `display`, which it already supports.
- `src/lib/plain-text.ts`: keep markdown link syntax intact (it already does not strip it) so the renderer can turn it into a labelled link; no behavior change needed beyond a confirming test.
- `src/lib/assistant-instructions.ts`: add one line stating that when the user asks for links, reply with full `https://` URLs, optionally in `[label](url)` form, and never invent URLs — only use addresses returned by web search.
- Plan cards already render `result_summary` through `DocLinkText`, so they inherit the same behavior.

## Verification

Ask for a few links with web search on and confirm each opens in a new tab, wraps correctly in the bubble, and that read-aloud does not speak raw URLs.
