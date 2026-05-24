// Phrase matchers for Call Mode.
// Loose, lowercased substring tests so natural variations still trigger.

const END_PATTERNS = [
  /\bhang up\b/,
  /\bend (the )?call\b/,
  /\bgood\s?bye\b/,
  /\bbye\b/,
  /\bsee (you|ya) (later|soon)\b/,
  /\btalk (to|with) you (later|soon)\b/,
  /\bi'?m (gonna |going to )?(go|leave)\b/,
];

const PLAN_PATTERNS = [
  /\bgenerate (a |the |that )?plan\b/,
  /\bmake (a |the |that )?plan\b/,
  /\bcreate (a |the |that )?plan\b/,
  /\bturn (that|this|it|the conversation|our (chat|conversation)) into (a )?plan\b/,
  /\bbuild (a |the |that )?plan\b/,
  /\bput (that|this|it) (into|in) (a )?plan\b/,
  /\bsave (that|this|it) as (a )?plan\b/,
];

// "Read / open / pull up" a document or documents.
const READ_DOC_PATTERNS = [
  /\bread (that|this|the|those|these|my) (document|doc|docs|documents|note|notes)\b/,
  /\b(read|open|pull up|load|grab|fetch) (the |that |a )?(document|doc|note) (called|named|titled)\b/,
  /\bread (it|them) (for me|now|please)?\b/,
  /\b(open|pull up|load|grab) (.+) (document|doc|note)s?\b/,
  /\b(read|open) (both|all|the) (of them|documents|docs|notes)\b/,
];

// "Add … to the X document".
const ADD_TEXT_PATTERNS = [
  /\badd (.+) to (the |my )?(.+) (document|doc|note)\b/,
  /\b(append|write|put|stick) (.+) (in|into|to) (the |my )?(.+) (document|doc|note)\b/,
  /\badd (this|that|the following) to (the |my )?(.+) (document|doc|note)\b/,
  /\bsave (this|that) (in|into|to) (the |my )?(.+) (document|doc|note)\b/,
];

// "Mark … for deletion" / "flag … for deletion".
const MARK_DELETE_PATTERNS = [
  /\bmark (.+) for (deletion|delete|removal)\b/,
  /\bflag (.+) for (deletion|delete|removal)\b/,
  /\bmark (that|this|the last|the current) (sentence|line|one) (for deletion|to delete)?\b/,
  /\bcross out (.+)\b/,
  /\bstrike (out |through )?(.+)\b/,
];

// "What's that document called?" / "name of the doc about X" / "find the doc that…"
const FIND_DOC_PATTERNS = [
  /\bwhat('?s| is| was) (that|the|this) (document|doc|note) called\b/,
  /\bwhat('?s| is| was) the (name|title) of (the |that |my )?(.+?)(document|doc|note)?\b/,
  /\b(do you |can you )?remember (the |that )?(name|title) of (.+)\b/,
  /\b(i |i'?ve )?(forgot|forget|can'?t remember|don'?t remember) (the |that )?(name|title) of (.+)\b/,
  /\bwhich (document|doc|note) (has|contains|is about|covers) (.+)\b/,
  /\b(find|look up|search for) (the |a |that )?(document|doc|note) (about|for|with|named|called|titled) (.+)\b/,
  /\bwhat (document|doc|note) (is about|covers|has) (.+)\b/,
  /\b(name|title) (of )?(that|the|this) (document|doc|note)\b/,
];


function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isEndCallPhrase(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return END_PATTERNS.some((re) => re.test(t));
}

export function isMakePlanPhrase(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return PLAN_PATTERNS.some((re) => re.test(t));
}

export function isReadDocPhrase(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return READ_DOC_PATTERNS.some((re) => re.test(t));
}

export function isAddTextPhrase(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return ADD_TEXT_PATTERNS.some((re) => re.test(t));
}

export function isMarkDeletePhrase(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return MARK_DELETE_PATTERNS.some((re) => re.test(t));
}

export function isFindDocPhrase(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return FIND_DOC_PATTERNS.some((re) => re.test(t));
}
