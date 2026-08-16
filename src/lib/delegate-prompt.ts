/**
 * Prompts used by the 🟣 Delegate button (menu slot 15).
 *
 * The user is standing on one sentence of a document. Delegate first asks Orby
 * for five concrete tasks it could do for that part of the document, shows them
 * as checkboxes in the chat, and then turns the checked ones into one
 * multi-step plan.
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

export const DELEGATE_CAP_KEYS = [
  "web_search",
  "image_analysis",
  "planning",
  "image_generation",
  "video_generation",
  "document_editing",
  "scheduling",
] as const;

export type DelegateCapKey = (typeof DELEGATE_CAP_KEYS)[number];

export type DelegateSuggestion = {
  title: string;
  detail: string;
  capabilities: DelegateCapKey[];
};


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

/** System prompt for the suggestion pass. */
export const DELEGATE_SUGGEST_SYSTEM = [
  "You are Orby, an assistant that works directly inside the user's documents.",
  "You can: read and edit documents (rewrite, add, remove sentences), search the web,",
  "generate images, generate videos, and schedule work for later.",
  "",
  "The user is standing on one line of their document and wants you to take work off their hands.",
  "First figure out whether that line is a substep of a larger task or a standalone task,",
  "and what the parent task is.",
  "Then propose exactly 5 concrete tasks you could carry out right now for that task.",
  "",
  "Rules for the suggestions:",
  "- Each one must be something you can actually do with your capabilities, phrased as an action.",
  "- Each one must serve the task the user is on (or its parent task). Never invent unrelated work.",
  "- Make them distinct from each other and specific to this document's actual content.",
  "- Plain text only. No markdown, no asterisks, no hashtags, no emoji.",
  "",
  "Also list, for each suggestion, which of your capabilities it needs. Valid values:",
  "web_search, image_analysis, planning, image_generation, video_generation, document_editing, scheduling.",
  "",
  "Reply with JSON only, no prose, in exactly this shape:",
  '{"task_context":"one short sentence naming the task or parent task you detected",',
  '"suggestions":[{"title":"short action label (max 8 words)","detail":"one sentence saying exactly what you would do","capabilities":["document_editing"]}]}',
  "The suggestions array must contain exactly 5 items.",

].join("\n");

/** User message for the suggestion pass. */
export function buildDelegateSuggestUserPrompt(args: {
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
    "Propose the 5 tasks now.",
  ].join("\n");
}

/**
 * The request sent into the chat once the user approves their picks. It becomes
 * the plan's user_request, so it carries the location, the picks and the scope.
 */
export type DelegatePick = { suggestion: DelegateSuggestion; note: string };

export function buildDelegatePlanPrompt(args: {
  title: string;
  sentences: string[];
  index: number;
  taskContext: string;
  picked: DelegatePick[];
}): string {
  const { title, sentences, index, taskContext, picked } = args;
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
    taskContext ? `TASK CONTEXT YOU IDENTIFIED: ${taskContext}` : "",
    "",
    "I APPROVED THESE TASKS — do all of them, and only these:",
    ...picked.map((p, i) => {
      const line = `${i + 1}. ${p.suggestion.title} — ${p.suggestion.detail}`;
      const note = (p.note ?? "").trim().slice(0, 2000);
      return note ? `${line}\n   EXTRA INFO FROM ME: ${note}` : line;
    }),

    "",
    "What I need you to do:",
    "1. Analyze the attached document again and confirm whether the line I am on is a substep or a standalone task, and what its parent task is.",
    "2. Write one complete multi-step plan that carries out the approved tasks above, in order, and start it.",
    "3. Use whatever capabilities each task needs — document editing, web search, image generation, video generation, scheduling.",
    "",
    "SCOPE RULE (most important): do only the approved tasks above, within the task or parent task I am on. Do not add, invent, or extend work I did not approve. Do not touch other steps or other documents.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
