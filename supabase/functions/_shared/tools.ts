export type ToolDef = {
  name: string;
  description: string;
  args: Record<string, { type: "string" | "number" | "boolean"; description: string; required: boolean }>;
};

export const TOOL_CATALOG: ToolDef[] = [
  {
    name: "find_document_by_title",
    description: "Find documents owned by the user whose title matches the query (fuzzy/substring). Returns up to 5 results, ranked by closeness.",
    args: {
      query: { type: "string", description: "Search text", required: true },
    },
  },
  {
    name: "find_sentence_by_content",
    description: "Find sentences whose content matches the query (fuzzy). If document_id is omitted, searches across ALL the user's documents. Returns up to 5 results.",
    args: {
      query: { type: "string", description: "Search text", required: true },
      document_id: { type: "string", description: "Optional UUID to restrict the search to one document", required: false },
    },
  },
  {
    name: "find_media_by_title",
    description: "Find media assets (images, videos, audio) whose title matches the query. Returns up to 5 results.",
    args: {
      query: { type: "string", description: "Search text", required: true },
    },
  },
  {
    name: "create_document",
    description: "Create a new empty document. Returns the new document's id and title.",
    args: {
      title: { type: "string", description: "Title for the new document", required: true },
    },
  },
  {
    name: "rename_document",
    description: "Rename an existing document.",
    args: {
      document_id: { type: "string", description: "UUID of the document", required: true },
      new_title: { type: "string", description: "New title", required: true },
    },
  },
  {
    name: "add_sentence",
    description: "Add a new sentence to a document. Position can be 'top', 'bottom', or 'after_current'. Default is 'bottom'.",
    args: {
      document_id: { type: "string", description: "Target document UUID", required: true },
      content: { type: "string", description: "Sentence text", required: true },
      position: { type: "string", description: "'top' | 'bottom' | 'after_current' (default 'bottom')", required: false },
    },
  },
  {
    name: "update_sentence_content",
    description: "Rewrite the content of an existing sentence.",
    args: {
      sentence_id: { type: "string", description: "UUID of the sentence", required: true },
      new_content: { type: "string", description: "New sentence text", required: true },
    },
  },
  {
    name: "move_sentence",
    description: "Move a sentence to a different document or position. Position is the same as add_sentence.",
    args: {
      sentence_id: { type: "string", description: "UUID of the sentence to move", required: true },
      target_document_id: { type: "string", description: "UUID of the destination document", required: true },
      position: { type: "string", description: "'top' | 'bottom' | 'after_current' (default 'bottom')", required: false },
    },
  },
  {
    name: "link_sentence_to_document",
    description: "Set the linked_document_id metadata on a sentence so it points to another document. Pass null as target_document_id to unlink.",
    args: {
      sentence_id: { type: "string", description: "UUID of the sentence", required: true },
      target_document_id: { type: "string", description: "UUID of the document to link to, or null to remove the link", required: true },
    },
  },
  {
    name: "mark_sentence_for_deletion",
    description: "Prepend the wastebasket emoji to a sentence's content (if not already present) so the user can find and remove it manually. This does NOT delete the sentence.",
    args: {
      sentence_id: { type: "string", description: "UUID of the sentence", required: true },
    },
  },
  {
    name: "mark_document_for_deletion",
    description: "Prepend the wastebasket emoji to a document's title (if not already present). This does NOT delete the document.",
    args: {
      document_id: { type: "string", description: "UUID of the document", required: true },
    },
  },
  {
    name: "mark_media_for_deletion",
    description: "Prepend the wastebasket emoji to a media asset's title (if not already present). This does NOT delete the media.",
    args: {
      media_id: { type: "string", description: "UUID of the media asset", required: true },
    },
  },
  {
    name: "rename_media",
    description: "Rename a media asset.",
    args: {
      media_id: { type: "string", description: "UUID of the media asset", required: true },
      new_title: { type: "string", description: "New title", required: true },
    },
  },
  {
    name: "web_search",
    description: "Search the live web for a query. Returns concise prose summarizing the findings.",
    args: {
      query: { type: "string", description: "What to research", required: true },
    },
  },
  {
    name: "generate_text",
    description: "Generate new prose with the AI, given a writing prompt. Returns the generated text. Useful when a step needs to produce content (a response, a summary, a list of ideas) that subsequent steps will insert.",
    args: {
      prompt: { type: "string", description: "What to write", required: true },
    },
  },
];

export function toolCatalogForPrompt(): string {
  return TOOL_CATALOG.map((t) => {
    const args = Object.entries(t.args)
      .map(([k, v]) => `    "${k}": <${v.type}${v.required ? "" : ", optional"}>  // ${v.description}`)
      .join("\n");
    return `- ${t.name}\n  ${t.description}\n  Args:\n${args}`;
  }).join("\n\n");
}
