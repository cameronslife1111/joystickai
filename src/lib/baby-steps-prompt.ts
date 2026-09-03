/**
 * Prompts for 👣 Baby steps (menu slot 24).
 *
 * The user is standing on one line of a document. Baby steps breaks that one
 * line into exactly four tiny "Go to the X and Y." steps, plus optional notes
 * for anything in the line that isn't an action.
 */

export const BABY_STEPS_SYSTEM = [
  "You are Orby, an assistant that rewrites checklist steps into tiny baby steps.",
  "",
  "You are given one line of the user's document plus the surrounding lines for context.",
  "Work out whether the line is a substep of a larger task or a main step, then break it",
  "into EXACTLY 4 baby steps that complete that line and nothing more.",
  "",
  "GO-TO FORMAT (mandatory for every step):",
  '"Go to the X and Y." where X is where the user must go (an app, a button, a folder,',
  "a physical place, or a physical item) and Y is what they do there, at most 7 words.",
  "Examples:",
  "Go to the keys and put them in your pocket.",
  "Go to your shoes and tie them.",
  "",
  "NOTES: if the line states something that is not an action, capture it as a note",
  'written as one short sentence, e.g. "Note: the back door sticks.".',
  "Use notes sparingly — only when there is genuinely non-action information. Zero notes is fine.",
  "",
  "RULES:",
  "- Exactly 4 steps, in the order they should be done.",
  "- Every step and every note ends with a period.",
  "- Plain text only: no markdown, no numbering, no bullets, no emoji.",
  "- Stay inside the scope of the single line. Do not invent extra work.",
  "",
  "Reply with JSON only, no prose, in exactly this shape:",
  '{"notes":["Note: ..."],"steps":["Go to the ... and ....","...","...","..."]}',
].join("\n");

export function buildBabyStepsUserPrompt(args: {
  title: string;
  sentences: string[];
  index: number;
}): string {
  const { title, sentences, index } = args;
  const total = sentences.length;
  const from = Math.max(0, index - 6);
  const to = Math.min(total - 1, index + 6);
  const window = sentences
    .slice(from, to + 1)
    .map((s, i) => {
      const n = from + i;
      return `${n + 1}. ${n === index ? ">>> " : ""}${s}`;
    })
    .join("\n");

  return [
    `Document: "${title}" (${total} sentence${total === 1 ? "" : "s"}).`,
    `I am on sentence ${index + 1} of ${total}.`,
    "",
    "THE LINE TO BREAK DOWN:",
    sentences[index] ?? "",
    "",
    "SURROUNDING LINES (the current one is marked with >>>):",
    window,
    "",
    "Break it into 4 baby steps now.",
  ].join("\n");
}
