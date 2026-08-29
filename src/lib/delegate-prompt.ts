/**
 * Prompts used by 🟣 Delegate (menu slot 15, and the purple orb long press).
 *
 * The user is standing on one sentence of a document. Delegate analyses that
 * line server-side, then sends one request into a fresh chat thread. Orby plans
 * it, picks its own capabilities, and shows the plan for review.
 */

const WINDOW = 6;

/** The numbered window of lines around the current one (current marked >>>). */
export function buildDocWindow(args: { sentences: string[]; index: number }): string {
  const { sentences, index } = args;
  const total = sentences.length;
  const from = Math.max(0, index - WINDOW);
  const to = Math.min(total - 1, index + WINDOW);
  return sentences
    .slice(from, to + 1)
    .map((s, i) => {
      const n = from + i;
      return `${n + 1}. ${n === index ? ">>> " : ""}${s}`;
    })
    .join("\n");
}

/** System prompt for the analysis pass (substep vs standalone task). */
export const DELEGATE_ANALYZE_SYSTEM = [
  "You are Orby, an assistant that works directly inside the user's documents.",
  "The user is standing on one line of their document. Work out whether that line is a substep",
  "of a larger task or a standalone task, and name the task you would carry out.",
  "",
  "Plain text only. No markdown, no asterisks, no emoji.",
  "",
  "Reply with JSON only, no prose, in exactly this shape:",
  '{"is_substep":true|false,',
  '"parent_task":"the larger task this line belongs to, or empty string when standalone",',
  '"task_context":"one short sentence naming the task you would carry out"}',
].join("\n");

export function buildDelegateAnalyzeUserPrompt(args: {
  title: string;
  sentences: string[];
  index: number;
}): string {
  const { title, sentences, index } = args;
  const total = sentences.length;
  return [
    `Document: "${title}" (${total} sentence${total === 1 ? "" : "s"}).`,
    `I am on sentence ${index + 1} of ${total}.`,
    "",
    "THE LINE I AM ON:",
    sentences[index] ?? "",
    "",
    "SURROUNDING LINES (the current one is marked with >>>):",
    buildDocWindow({ sentences, index }),
    "",
    "Analyze it now.",
  ].join("\n");
}

/**
 * The request sent into the chat. It becomes the plan's user_request, so it
 * carries the location, the detected task and the scope rule.
 */
export function buildDelegatePlanPrompt(args: {
  title: string;
  sentences: string[];
  index: number;
  taskContext: string;
  isSubstep: boolean;
  parentTask: string;
}): string {
  const { title, sentences, index, taskContext, isSubstep, parentTask } = args;
  const total = sentences.length;
  return [
    `Document: "${title}" (${total} sentence${total === 1 ? "" : "s"}).`,
    `I am on sentence ${index + 1} of ${total}.`,
    "",
    "THE STEP I WANT YOU TO DO:",
    sentences[index] ?? "",
    "",
    "SURROUNDING LINES (the current one is marked with >>>):",
    buildDocWindow({ sentences, index }),
    "",
    isSubstep
      ? `THIS LINE IS A SUBSTEP OF: ${parentTask || "a larger task in this document"}`
      : "THIS LINE IS A STANDALONE TASK.",
    taskContext ? `TASK: ${taskContext}` : "",
    "",
    "What I need you to do:",
    "1. Plan how to complete this step (and, if it is a substep, only the part of the parent task this step covers).",
    "2. Decide for yourself which of your capabilities the work needs — document editing, web search, image generation, video generation, scheduling, multi-step planning — and say plainly which you will use for what.",
    "3. Put the output where it belongs: back into this document when the step is about the document, otherwise back into this chat.",
    "",
    "SCOPE RULE (most important): do only what this step asks. Do not add, invent, or extend work the document does not ask for. Do not touch other steps or other documents.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
