Update the chat message rendering in `src/components/ChatDialog.tsx` so both user and assistant messages are easier to read and assistant plain-text responses are no longer formatted as markdown.

Changes:
- Bump message text size from `text-sm` to `text-[25px]` for both user and assistant message containers.
- Remove `ReactMarkdown` and the `prose` wrapper from regular assistant messages; render them with `whitespace-pre-wrap` plain text, just like user messages.
- Keep planning messages (`kind === "plan"`) unchanged so plan progress cards still render normally.
- Remove the now-unused `ReactMarkdown` import if it is no longer used elsewhere in the file.

This will make assistant outputs appear as plain text without bold, bullets, or numbered lists, while keeping everything else working as before.