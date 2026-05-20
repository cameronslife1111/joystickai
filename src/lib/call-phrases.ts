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
