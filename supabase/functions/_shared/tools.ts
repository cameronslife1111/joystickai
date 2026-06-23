export type ToolDef = {
  name: string;
  description: string;
  args: Record<string, { type: "string" | "number" | "boolean"; description: string; required: boolean }>;
};

export const TOOL_CATALOG: ToolDef[] = [
  {
    name: "find_document_by_title",
    description: "Find documents owned by the user whose title fuzzily matches the query. Tokenized and scored — tolerates loose/approximate wording, never requires exact title. Returns up to 5 results, best match first. Use this to locate a SINGLE target document. For acting on EVERY document matching a description, use find_documents_by_title instead, or enumerate from the WORKSPACE SNAPSHOT. PREFER picking the id directly from the WORKSPACE SNAPSHOT over calling this tool.",
    args: {
      query: { type: "string", description: "Rough description of the document — title fragments, keywords, or topic", required: true },
    },
  },
  {
    name: "find_documents_by_title",
    description: "Find ALL documents owned by the user whose title matches the query (prefix / substring / keywords). Unlike find_document_by_title (which returns only the 5 best matches), this returns EVERY match — use it for bulk operations like 'add all docs starting with X to another doc'. Returns an array of { id, title }, best match first. PREFER enumerating titles directly from the WORKSPACE SNAPSHOT's ALL DOCUMENTS list when they are visible there; only call this when the matching set may exceed what the snapshot shows.",
    args: {
      query: { type: "string", description: "Title prefix, fragment, or keywords shared by the documents to enumerate", required: true },
      limit: { type: "number", description: "Optional max number of results (default 100)", required: false },
    },
  },
  {
    name: "read_document",
    description:
      "Read the full contents of a document. Returns { id, title, text, sentences: [{ id, order_index, content }] } where `text` is all sentences joined with newlines. " +
      "Use this when you need to USE the text of a document in a later step (e.g. pass a prompt stored in the doc into an image-generation step). " +
      "When piping into another step's string arg (like a prompt), ALWAYS reference `{{step_N.result.text}}` — NEVER `{{step_N.result.sentences}}` (that's an array of objects and will fail). " +
      "The full text of documents the user named is usually ALREADY inlined in the WORKSPACE SNAPSHOT — in that case, inline the text directly into the next step's args instead of calling this tool.",
    args: {
      document_id: { type: "string", description: "UUID of the document to read", required: true },
    },
  },
  {
    name: "find_sentence_by_content",
    description:
      "Locate a SPECIFIC sentence row to mutate (edit/move/mark/link). Fuzzy token-scored match — tolerates loose wording, never requires the user to remember exact phrasing. Returns up to 5 candidates, best match first. " +
      "Do NOT use this to retrieve content for use in a later step — use read_document or inline from the WORKSPACE SNAPSHOT instead. " +
      "If document_id is omitted, searches across all the user's documents.",
    args: {
      query: { type: "string", description: "Rough description of the sentence — keywords or topic", required: true },
      document_id: { type: "string", description: "Optional UUID to restrict the search to one document", required: false },
    },
  },
  {
    name: "find_media_by_title",
    description:
      "Find a SINGLE media asset (image, video, or audio) by rough description. Tokenized, emoji-aware, and shortcode-aware FUZZY scoring across the title AND the original generation prompt — tolerates loose/approximate wording and NEVER requires the exact title (e.g. 'the cat image' matches an asset titled 'Whiskers on the couch' or generated from a prompt containing 'cat'; 'the red circle video' matches a title starting with 🔴). " +
      "Returns up to 5 results, best match first, each with id, title, kind, and source_text (the original prompt if AI-generated, otherwise null). " +
      "PREFER picking the id directly from the MEDIA CATALOG in the WORKSPACE SNAPSHOT over calling this tool. For acting on EVERY media asset matching a description, use find_all_media_by_title instead.",
    args: {
      query: { type: "string", description: "Rough description of the media — title fragments, keywords, topic, emoji, or words from its original prompt", required: true },
      kind: { type: "string", description: "Optional filter: 'image' | 'video' | 'audio'", required: false },
    },
  },
  {
    name: "find_all_media_by_title",
    description:
      "Find ALL media assets (images, videos, audio) matching a rough description. Unlike find_media_by_title (which returns only the 5 best matches), this returns EVERY fuzzy match, best match first — use it to 'look through all my titles and pick the ones I mean' or for bulk operations (e.g. 'remix all my sunset images', 'animate every portrait'). " +
      "Returns an array of { id, title, kind, source_text }. Same emoji/shortcode-aware fuzzy scoring as find_media_by_title. " +
      "PREFER enumerating matches directly from the MEDIA CATALOG in the WORKSPACE SNAPSHOT when the assets are visible there; only call this when the matching set may exceed what the snapshot shows.",
    args: {
      query: { type: "string", description: "Title fragment, keywords, topic, or emoji shared by the media to enumerate", required: true },
      kind: { type: "string", description: "Optional filter: 'image' | 'video' | 'audio'", required: false },
      limit: { type: "number", description: "Optional max number of results (default 100)", required: false },
    },
  },
  {
    name: "expand_plan",
    description:
      "Generate additional plan steps AT RUNTIME, after earlier steps have produced data you don't have yet at planning time. Use this for 'do X for EACH item' loops where the number of items is only known after reading a document — e.g. 'generate one first-frame image for each shot in the brain dump', 'add one sentence per approved idea'. " +
      "How it works: when this step runs, an AI reads the `context` you pipe in (typically the text of a document read by an earlier read_document step) plus the live workspace, then writes a fresh batch of real tool steps (generate_image, remix_images, rename_media, add_sentence, etc.) that are spliced into the plan and executed in order. " +
      "ALWAYS pipe the source material into `context` via templates, e.g. context: \"Brain dump:\\n{{step_2.result.text}}\\n\\nRules:\\n{{step_3.result.text}}\". Put the per-item instruction (what to do for each discovered item, including which media/reference ids to use and how to name outputs) in `instruction`. The generated steps can reference earlier steps by their absolute index using {{step_N...}} as usual.",
    args: {
      instruction: { type: "string", description: "What to do for EACH discovered item — be specific about the tool to use per item, the prompt/content, target ids, and any renaming. The runtime AI follows this to emit one (or a few) steps per item.", required: true },
      context: { type: "string", description: "The source material to derive the items from — pipe in document text via {{step_N.result.text}} templates (brain dump, rules, approved-ideas list, etc.).", required: true },
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
    description: "Add a new sentence to a document. Position can be 'top' or 'bottom'. Default is 'bottom'. Do NOT use 'after_current' — plans have no notion of a 'current' sentence. The target document_id is REQUIRED and must be a concrete document id from the WORKSPACE SNAPSHOT or a {{step_N.result.id}} template (e.g. from a create_document step); never rely on an implied or 'previous' document.",
    args: {
      document_id: { type: "string", description: "Target document UUID", required: true },
      content: { type: "string", description: "Sentence text", required: true },
      position: { type: "string", description: "'top' | 'bottom' (default 'bottom')", required: false },
    },
  },
  {
    name: "update_sentence_content",
    description: "Rewrite the content of an existing sentence. The target sentence_id is REQUIRED and must be a concrete sentence id from the WORKSPACE SNAPSHOT or a {{step_N.result.id}} template; never rely on an implied or 'previous' sentence.",
    args: {
      sentence_id: { type: "string", description: "UUID of the sentence", required: true },
      new_content: { type: "string", description: "New sentence text", required: true },
    },
  },
  {
    name: "move_sentence",
    description: "Move a sentence to a different document. Position is 'top' or 'bottom' (default 'bottom'). Do NOT use 'after_current' — plans have no notion of a 'current' sentence. Both the sentence_id (what to move) and target_document_id (where it goes) are REQUIRED and must each be a concrete id from the WORKSPACE SNAPSHOT or a {{step_N.result.id}} template; never rely on an implied source or destination.",
    args: {
      sentence_id: { type: "string", description: "UUID of the sentence to move", required: true },
      target_document_id: { type: "string", description: "UUID of the destination document", required: true },
      position: { type: "string", description: "'top' | 'bottom' (default 'bottom')", required: false },
    },
  },
  {
    name: "link_sentence_to_document",
    description: "Set the linked_document_id metadata on a sentence so it points to another document. Pass null as target_document_id to unlink. The sentence_id is REQUIRED and (unless unlinking) target_document_id must be a concrete document id from the WORKSPACE SNAPSHOT or a {{step_N.result.id}} template; never rely on an implied target.",
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
    description: "Search the live web for a query. Returns { text: string }. Pipe with {{step_N.result.text}} (or {{step_N.result}} — both resolve to the prose).",
    args: {
      query: { type: "string", description: "What to research", required: true },
    },
  },
  {
    name: "generate_text",
    description: "Generate new prose with the AI, given a writing prompt. Returns { text: string }. Pipe with {{step_N.result.text}} (or {{step_N.result}}).",
    args: {
      prompt: { type: "string", description: "What to write", required: true },
    },
  },
  {
    name: "generate_image",
    description:
      "Create a brand-new image from a text prompt. The image is saved to the user's Media Gallery. Returns the new media asset id and title when complete. " +
      "Optional overrides: image_size (one of 'portrait_16_9' [default, equals 9:16], 'portrait_4_3', 'square_hd', 'landscape_4_3', 'landscape_16_9'), " +
      "quality ('low'|'medium'|'high', default 'high'), " +
      "output_format ('png'|'jpeg'|'webp', default 'png'). " +
      "Use defaults unless the user clearly asks otherwise (e.g. 'wide' → landscape_16_9, 'tall' or 'phone wallpaper' → portrait_16_9, 'square' → square_hd).",
    args: {
      prompt: { type: "string", description: "What to draw", required: true },
      image_size: { type: "string", description: "Optional aspect/size preset", required: false },
      quality: { type: "string", description: "Optional quality", required: false },
      output_format: { type: "string", description: "Optional output format", required: false },
    },
  },
  {
    name: "regenerate_image",
    description:
      "Create a NEW image that's a variation of an existing image, with a modification prompt. Use this when the user says 'make a version of X that...' or 'redo the image of Y with...'. " +
      "source_media_id must be the id of an existing image media asset. The new image is saved as a separate asset; the original is untouched. " +
      "Optional overrides: image_size (one of 'portrait_16_9', 'portrait_4_3', 'square_hd', 'landscape_4_3', 'landscape_16_9'; default 'portrait_16_9' — do NOT pass 'auto'), quality, output_format.",
    args: {
      source_media_id: { type: "string", description: "UUID of the source image asset", required: true },
      prompt: { type: "string", description: "What to change", required: true },
      image_size: { type: "string", description: "Optional aspect preset: portrait_16_9 | portrait_4_3 | square_hd | landscape_4_3 | landscape_16_9", required: false },
      quality: { type: "string", description: "Optional quality", required: false },
      output_format: { type: "string", description: "Optional output format", required: false },
    },
  },
  {
    name: "remix_images",
    description:
      "Create a NEW image by COMBINING 2-16 existing images together, guided by a prompt describing how to merge them (e.g. 'put the character from image 1 into the background of image 2', 'blend these product shots into one collage'). " +
      "Use remix_images ONLY when the result must draw from MULTIPLE existing source images. For a single source image, use regenerate_image. For a brand-new image from scratch (no source), use generate_image. " +
      "source_media_ids is an array of 2-16 image asset UUIDs — you MUST resolve every source id first (pick them from the MEDIA CATALOG, or via find_media_by_title / find_all_media_by_title, then template them in, e.g. [\"{{step_0.result[0].id}}\", \"{{step_1.result[0].id}}\"]). The new image is saved as a separate asset; sources are untouched. " +
      "Optional overrides: image_size (one of 'portrait_16_9', 'portrait_4_3', 'square_hd', 'landscape_4_3', 'landscape_16_9'; default 'portrait_16_9' — do NOT pass 'auto', fal rejects it with multiple input images), quality, output_format.",
    args: {
      source_media_ids: { type: "string", description: "JSON array of 2-16 image asset UUIDs (concrete ids from the MEDIA CATALOG or {{step_N.result[...].id}} templates)", required: true },
      prompt: { type: "string", description: "How to combine the source images", required: true },
      image_size: { type: "string", description: "Optional aspect preset: portrait_16_9 | portrait_4_3 | square_hd | landscape_4_3 | landscape_16_9", required: false },
      quality: { type: "string", description: "Optional quality", required: false },
      output_format: { type: "string", description: "Optional output format", required: false },
    },
  },
  {
    name: "image_to_video",
    description:
      "Animate a still image into a short video using a motion prompt. source_media_id must be the id of an existing image asset. " +
      "Optional overrides: duration (integer seconds 3-15, default 5), generate_audio (boolean, default false), end_media_id (uuid of an image to use as the final frame), negative_prompt (default 'blur, distort, and low quality'), cfg_scale (number 0-1, default 0.5).",
    args: {
      source_media_id: { type: "string", description: "UUID of the source image asset", required: true },
      prompt: { type: "string", description: "Describe the motion or action", required: true },
      duration: { type: "number", description: "Seconds 3-15", required: false },
      generate_audio: { type: "boolean", description: "Generate native audio", required: false },
      end_media_id: { type: "string", description: "Optional UUID of an image to use as the end frame", required: false },
      negative_prompt: { type: "string", description: "Negative prompt", required: false },
      cfg_scale: { type: "number", description: "Prompt adherence 0-1", required: false },
    },
  },
  {
    name: "video_to_video",
    description:
      "Use the motion of a reference video applied to the appearance of an image. source_image_id is the appearance reference (an image asset). reference_video_id is the motion source (a video asset). " +
      "Optional overrides: character_orientation ('image' or 'video'; default 'image'. 'image' is better for camera moves, capped at 10s. 'video' is better for complex motion, capped at 30s, and enables element_image_id), " +
      "keep_original_sound (boolean, default true), element_image_id (uuid of an image used as a facial-element reference; ONLY usable when character_orientation is 'video').",
    args: {
      source_image_id: { type: "string", description: "UUID of the appearance image asset", required: true },
      reference_video_id: { type: "string", description: "UUID of the motion video asset", required: true },
      prompt: { type: "string", description: "Describe the scene or action", required: true },
      character_orientation: { type: "string", description: "'image' or 'video'", required: false },
      keep_original_sound: { type: "boolean", description: "Carry reference audio into output", required: false },
      element_image_id: { type: "string", description: "Optional facial-element image asset UUID (only with character_orientation 'video')", required: false },
    },
  },
  {
    name: "audio_image_to_video",
    description:
      "Animate a face image to lip-sync to an audio clip, producing a talking-head video. source_image_id is the face source (image asset). audio_media_id is the audio asset to sync to. " +
      "Optional overrides: talking_style ('stable' [default] or 'expressive'), resolution ('360p'|'480p'|'540p'|'720p'|'1080p', default '1080p'), aspect_ratio ('9:16' [default], '16:9', '1:1'), caption (boolean, default false).",
    args: {
      source_image_id: { type: "string", description: "UUID of the face image asset", required: true },
      audio_media_id: { type: "string", description: "UUID of the audio asset", required: true },
      talking_style: { type: "string", description: "Animation style", required: false },
      resolution: { type: "string", description: "Output resolution", required: false },
      aspect_ratio: { type: "string", description: "Output aspect ratio", required: false },
      caption: { type: "boolean", description: "Burn captions into the video", required: false },
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
