/**
 * Prompt used by the 🟣 Delegate button (menu slot 15).
 *
 * The user is standing on one sentence of a document. Delegate hands that step
 * to Orby: it gets the step, a small window of surrounding lines (so it can
 * tell a substep from a standalone task), and a hard scope rule so it never
 * does work the document didn't ask for.
 */

const WINDOW = 6;

/** Sentences that hint the step needs live info from the internet. */
const WEB_HINTS = [
  "web",
  "search the web",
  "online",
  "look up",
  "google",
  "internet",
  "http://",
  "https://",
];

export function needsWebSearch(sentence: string): boolean {
  const s = (sentence ?? "").toLowerCase();
  return WEB_HINTS.some((h) => s.includes(h));
}

export function buildDelegatePrompt(args: {
  title: string;
  sentences: string[];
  index: number;
}): string {
  const { title, sentences, index } = args;
  const total = sentences.length;
  const current = sentences[index] ?? "";
  const from = Math.max(0, index - WINDOW);
  const to = Math.min(total - 1, index + WINDOW);

  const context = sentences
    .slice(from, to + 1)
    .map((s, i) => {
      const n = from + i;
      return `${n + 1}. ${n === index ? ">>> " : ""}${s}`;
    })
    .join("\n");

  return [
    `Document: "${title}" (${total} sentence${total === 1 ? "" : "s"}).`,
    `I am currently on sentence ${index + 1} of ${total}.`,
    "",
    "THE STEP I AM ON:",
    current,
    "",
    `SURROUNDING LINES (the current one is marked with >>>):`,
    context,
    "",
    "What I need you to do:",
    "1. Analyze the attached document.",
    "2. Decide whether the step I am on is a substep of a larger task or a standalone task. If it is a substep, work the full parent task it belongs to. If it is a standalone task, work that task.",
    "3. Write a complete plan for that task and start it.",
    "",
    "SCOPE RULE (most important): do only what that step, or its parent task, actually says. Do not add, invent, or extend work the document does not ask for. Do not touch other steps or other documents.",
  ].join("\n");
}
