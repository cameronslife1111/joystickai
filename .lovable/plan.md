## Goal

In Call Mode, let the user ask "what's that document called?" (or describe a document by topic/guess) and have Orby speak back the correct title(s) without reading, opening, or modifying anything. After Orby answers, the conversation continues normally so the user can decide what to do next.

## Approach

Add a new lightweight voice intent: **"find / name the document"**. It reuses the existing fuzzy AI resolver (`resolveDocumentsByVoice`) — no DB changes, no new server function needed.

### 1. New phrase matcher — `src/lib/call-phrases.ts`

Add `isFindDocPhrase(text)` that matches natural ways of asking for a title:

- "what's that document called"
- "what's the name of the doc about <X>"
- "what was that note called"
- "do you remember the title of <X>"
- "which document has <X>" / "find the document about <X>"
- "i forgot the name of the document <about/for/with> <X>"

Must NOT collide with existing `isReadDocPhrase` / `isAddTextPhrase` / `isMarkDeletePhrase`. We'll check this intent FIRST in `commitUtterance` so e.g. "what's the document called" doesn't get swallowed by anything else.

### 2. Handler in `CallModeContext.tsx`

In `commitUtterance`, add a branch before the read/add/mark branches:

```text
if (isFindDocPhrase(text)) {
  stopRecognition();
  setStatus("thinking");
  setActionLabel("Looking that up…");
  const recent = <last 6 messages joined as today>;
  const { matches } = await resolveDocsFn({
    data: {
      utterance: text,
      recentTranscript: recent,
      expectMultiple: true,   // user may be fishing across several
      purpose: "read",        // existing enum, semantically fine for lookup
    },
  });
  const confident = matches.filter(m => m.confidence >= 0.35).slice(0, 3);
  let reply: string;
  if (confident.length === 0) {
    reply = "I don't see a document that matches. Want to describe what it's about?";
  } else if (confident.length === 1) {
    reply = `The title you may be referring to is "${confident[0].title}". Want me to read it or add something to it?`;
  } else {
    const list = confident.map(m => `"${m.title}"`).join(", ");
    reply = `It could be one of these: ${list}. Which one did you mean?`;
  }
  setMessages(prev => [...prev, { role: "assistant", content: reply }]);
  setStatus("speaking");
  await speakAsync(reply);
  setActionLabel(null);
  if (!inCallRef.current) return;
  setStatus("listening");
  startRecognition();
  return;
}
```

Notes:
- We deliberately do NOT push the document content into the context — the user only wants the *name*. If they then say "read it" or "add X to it", the existing read/add intents handle the next turn (and `resolveDocumentsByVoice` already considers `recentTranscript`, so the just-spoken title will resolve correctly).
- Threshold is slightly looser (0.35) since users are explicitly fishing.
- Cap at 3 suggestions so TTS stays short.

### 3. System prompt nudge — `src/lib/orby-call.functions.ts`

Add one short line to the existing system prompt so the LLM stays consistent if the regex misses and the message hits the normal chat path:

> If the user asks what a document is called, who has the title for X, or is trying to remember a document's name, give the closest matching title from prior context briefly (e.g. "The title you may be referring to is 'X'.") and offer no follow-up actions unless asked.

### 4. Order of intents in `commitUtterance`

```text
end → make plan → FIND DOC (new) → read doc → add text → mark delete → normal chat
```

Putting "find" before "read" matters because "what's that document" shares vocabulary with read intents.

## Files touched

- `src/lib/call-phrases.ts` — add `isFindDocPhrase` + patterns
- `src/contexts/CallModeContext.tsx` — import it, add new branch in `commitUtterance`
- `src/lib/orby-call.functions.ts` — one extra sentence in the system prompt

## Verification

- Start a call, say "Hey, what's the document called that has the meme stuff?" → Orby replies with the title and asks what you want to do.
- Say "I forgot the name of that checklist" → Orby returns the closest match.
- Say "what was that document called" with no context → Orby says it doesn't see one and asks for a topic.
- Say "read the meme document" right after → existing read intent still fires (regression check).
- Say "add 'buy milk' to the checklist document" → existing add intent still fires.

## Out of scope

- No new DB columns, no new server function, no UI changes.
- Not changing the reading panel.
- Not auto-opening / auto-reading the matched doc — explicitly user-initiated next turn.
