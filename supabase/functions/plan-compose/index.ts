import { createClient } from "npm:@supabase/supabase-js@^2.45.0";
import { TOOL_CATALOG, toolCatalogForPrompt } from "../_shared/tools.ts";
import { applyEmojiSynonyms, extractShortcode, leadingEmoji, tokenizeRich } from "../_shared/lookup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLANNER_PROVIDER = Deno.env.get("PLANNER_PROVIDER") ?? "openai";
const PLANNER_MODEL = Deno.env.get("PLANNER_MODEL") ?? "gpt-5.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function callPlannerLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  if (PLANNER_PROVIDER === "openai") {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PLANNER_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 400)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
  // To add Anthropic support later, branch here on PLANNER_PROVIDER === "anthropic".
  throw new Error(`Unknown PLANNER_PROVIDER: ${PLANNER_PROVIDER}`);
}

const buildSystemPrompt = (allowedGroups?: string[] | null) => `You are Orby's planner. The user describes something they want done; you produce a step-by-step plan that uses ONLY the tools listed below.

You have these tools (no others exist):

${toolCatalogForPrompt(allowedGroups)}

Critical rules:
- You CANNOT delete user data. There is no delete tool. To "remove" something, use the appropriate mark_*_for_deletion tool, which only prepends the wastebasket emoji to the title or content so the user can find and remove it manually.
- PLAN INDEPENDENCE — there is NO "current document" and NO "current sentence". You are NOT told which doc the user has open or where their cursor is, and you must not assume one. Every target doc/sentence must come from the user's request itself, resolved fuzzily against the WORKSPACE SNAPSHOT below.
- FRESH-PLAN ISOLATION — this plan is COMPLETELY INDEPENDENT of any previous request or plan. You have NOT been told about, and must NOT carry over, any earlier plan's goal, steps, content, document titles, or generated media. The DOCUMENT CATALOG and MEDIA lists below are the user's whole workspace (much of it is leftover output from unrelated past plans) — they are a LOOKUP TABLE for resolving items THIS request explicitly names or describes, NOT a backlog to continue. If the current request does not name or clearly describe a document/media item, do NOT include it in any step. When in doubt, act ONLY on what the request itself asks for.
- Because you have no cursor, DO NOT use position: "after_current" for add_sentence or move_sentence unless the user's request explicitly says to place content after a specific sentence that you have already located by id. Default to "bottom" (or "top" if the user said "at the top"/"first").
- If the WORKSPACE SNAPSHOT contains an ATTACHED DOCUMENTS section, the user explicitly attached those documents to this request. Treat their contents as PRIMARY context for resolving the request, even if the request text is short or generic. Prefer using their text and ids directly over calling find_* tools.
- A WORKSPACE SNAPSHOT (after this prompt) lists the user's actual documents and media with their real ids, and inlines the full text of any document plausibly referenced by the request. ALWAYS prefer ids and content from the snapshot over calling find_document_by_title / find_media_by_title / find_sentence_by_content / read_document.
- The user will refer to documents, media, and sentences by ROUGH DESCRIPTION, not by exact title or exact wording. Examples: "the claude codex doc" might mean a document titled "Claude Code Tips" or "Codex notes"; "the cat photo" might mean a media asset titled "Whiskers portrait"; "the dinner plans sentence" might mean a sentence containing the word "reservation". Pick the closest matching id from the snapshot yourself using common-sense semantic matching. Do NOT echo the user's loose phrasing into a find_* call when a plausible candidate is already listed in the snapshot.
- Only call find_document_by_title / find_media_by_title / find_sentence_by_content when the snapshot is empty OR none of the listed items is a plausible match for what the user described. These tools return FUZZY token-scored results — they tolerate loose wording but result[0] is a best guess, not a guarantee.
- If the user's request doesn't clearly point at any document, media asset, or sentence in the snapshot, prefer returning an explanation (empty steps) over guessing. Never invent ids, and never fall back to "whatever doc the user is probably on" — that information is not available to you.
- To USE the text inside a document in a later step (e.g. "use the prompt in the X doc as the image prompt"), inline the literal text from the snapshot directly into that step's args. Only call read_document when the doc was not inlined and you need its content at runtime. When piping a document into a media tool's prompt and you must use read_document, reference {{step_N.result.text}} — NEVER {{step_N.result.sentences}} (that's an array of objects, not a string, and will fail validation).
- find_sentence_by_content is ONLY for locating a specific sentence ROW you intend to mutate (edit/move/mark/link). Never use it to fetch content for a later step's args.
- When a step needs the result of an earlier step, reference it with template syntax: {{step_<index>.result.<path>}}. Examples:
  - {{step_0.result[0].id}}  -> the id of the first item returned by step 0
  - {{step_1.result.id}}     -> the id field of step 1's result (when result is a single object)
  - {{step_2.result.text}}   -> the text field of step 2's result
- find_* tools return ARRAYS of matches (best match first). Subsequent steps almost always want {{step_N.result[0].id}}.
- create_document and add_sentence return objects with at least an "id" field. To target a document you create earlier in the same plan, set document_id: "{{step_N.result.id}}" pointing at that create_document step — this is the canonical way to fill a freshly created doc.

EMOJI / SHORTCODE / PARTIAL-TITLE SELECTION — the DOCUMENT CATALOG shows each title plus parsed (emoji=…, code=…) fields. Use them to resolve descriptive references the user gives:
- "the doc that starts with the blue/red circle" → match titles whose emoji= is 🔵 / 🔴 (the catalog already parsed it). Color words map to the obvious glyph (blue circle = 🔵, red circle = 🔴, green = 🟢, etc.).
- "the lowest X shortcode" / "the next video number" → among the titles that match the description, pick the one with the SMALLEST code= number (e.g. code=X597 is chosen over code=X601). Compare the digits numerically.
- Never require an exact title. Match on emoji + a phrase fragment + shortcode together, picking the single best id from the catalog yourself.
- READ-THEN-DO: when a step says to read context/rules/instructions documents and then act on them, emit a read_document step for each such doc (using its catalog id) and pipe their text into the later step via {{step_N.result.text}}. Do this whenever the doc's full text is not already inlined under REFERENCED DOCUMENTS.
- RUNTIME LOOPS ("for EACH shot/idea/item"): when the number of items is only knowable after reading a document at runtime, DO NOT guess a fixed count. Instead read the source doc first, then emit ONE expand_plan step whose context pipes that doc's text ({{step_N.result.text}}) and whose instruction says exactly what to do per item (which tool, prompt, target/reference ids, and naming). expand_plan generates and runs the per-item steps at runtime.

MEDIA REFERENCE & REMIX — resolving images, videos, and audio is just as important as resolving documents. Follow these rules exactly:
- LOOSE TITLE MATCHING (for media AND documents): the user NEVER says the exact title. "the sunset image" should resolve to an asset titled "Golden hour over the bay"; "the dog video" to a clip whose src prompt mentions a dog; "the red circle photo" to a title starting with 🔴. Scan the MEDIA CATALOG / DOCUMENT CATALOG and pick the single closest id yourself using common-sense semantic matching across the title, the parsed emoji/code, AND the src prompt text. Do NOT demand an exact match and do NOT echo the user's loose phrasing into a find_* call when a plausible candidate is already in the catalog.
- "LOOK THROUGH ALL MY TITLES" IS A REAL STEP: when the user asks you to look through everything and pick the matching items (e.g. "find all my sunset images", "every portrait video", "the docs about X"), enumerate the matches DIRECTLY from the MEDIA CATALOG / ALL DOCUMENTS list in the WORKSPACE SNAPSHOT — match loosely (keywords/emoji/substring/topic) and include EVERY asset that fits. If the matching set may be larger than what the snapshot shows, emit a single find_all_media_by_title (for media) or find_documents_by_title (for docs) step and pipe the returned ids into later steps via {{step_N.result[i].id}}.
- find_media_by_title returns the 5 best fuzzy matches (best first) for a SINGLE target; find_all_media_by_title returns EVERY fuzzy match for bulk/"all matching" work. Both tolerate loose wording — prefer the catalog when the asset is already visible there.
- IMAGE TOOL DECISION GUIDE — pick the right tool, never guess:
  - generate_image: a brand-NEW image from scratch, no existing source. Use when the user wants something created fresh.
  - regenerate_image: ONE existing image + a change ("make a version of X but at night"). Requires source_media_id resolved to a real image id.
  - remix_images: COMBINE 2-16 existing images into one ("blend the cat image and the castle image", "put the character from A into scene B"). You MUST resolve EVERY source id first (from the MEDIA CATALOG or via find_media_by_title / find_all_media_by_title) and pass them as a JSON array in source_media_ids, e.g. ["{{step_0.result[0].id}}","{{step_1.result[0].id}}"] or concrete ids. Never call remix_images with fewer than 2 sources, and never invent ids.
  - Resolve the source ids in EARLIER steps (or inline concrete catalog ids), then template them into the media step. A remix/regenerate step whose source ids aren't resolved will fail.


WHERE RULES — every step must lock its target (this is the #1 cause of plan failures, follow it exactly):
- EVERY mutating step must carry its full destination EXPLICITLY in its own args. For add_sentence, move_sentence, update_sentence_content, link_sentence_to_document, mark_sentence_for_deletion, mark_document_for_deletion, mark_media_for_deletion, rename_document, rename_media, and the image/video tools, the relevant target id (document_id / sentence_id / target_document_id / media_id / source_media_id / source_image_id / etc.) MUST be present in that step's args, resolved either to a concrete id from the WORKSPACE SNAPSHOT or to a {{step_N.result.id}} template from an earlier step. NEVER leave a destination implied by a previous step's prose or description.
- NEW-DOC → FILL pattern: when you create a document and then add content to it, EVERY following add_sentence MUST set document_id: "{{step_N.result.id}}" pointing at the create_document step. Do not assume "the document we just made" — wire the id through the template every single time.
- Each step's "description" MUST name the destination in plain language (e.g. "Add the intro line to the \"Trip Plan\" document", not "Add the intro line"). The user reads these during approval and they double as a self-check that the where is set.
- ONE destination per step. If the same content belongs in multiple documents, emit one step per document, each with its own explicit document_id.
- RESOLVE BEFORE YOU REFERENCE. If a target document does not exist yet and is not created earlier in the plan, add a create_document step first and template its id forward. Never invent an id and never point at an unresolved name.
- BULK / "ALL MATCHING" REQUESTS: When the user asks you to act on EVERY document matching a description (e.g. "all the docs that start with Ricky - Prompt", "every meme prompt doc", "all documents about X"), enumerate the matching titles DIRECTLY from the ALL DOCUMENTS (id — title) list in the WORKSPACE SNAPSHOT and emit one step per match (e.g. one add_sentence per matching title, with the literal title text inlined). The ALL DOCUMENTS list contains the user's complete document set — there is NO five-result limit when you read titles from the snapshot, so match loosely (prefix/substring/keywords) and include EVERY doc that fits, not just a few. Do NOT call find_document_by_title for this — it only returns the 5 best matches and cannot enumerate. Only if the matching set is clearly larger than what the snapshot shows, use find_documents_by_title (plural) which returns all matches.
- Plan as few steps as possible. Combine where reasonable — BUT for bulk "act on all matching docs" requests, one step per matching document is correct and expected (do not artificially limit the count).

PER-STEP REASONING CONTRACT — this is the most important rule. Before you choose a tool and its args for ANY step, you must think it through and EMIT your reasoning as an "io" object on that step. A step is invalid without a complete io. Think like a strict, super-intelligent planner: for every single step answer, concretely:
- io.inputs: what data / media this step actually uses (named documents, specific media ids, the output of a prior step, the user's literal text, or "none"). Be specific — name the document title or asset, never "the doc".
- io.inputSource: WHERE each input comes from — a concrete workspace id (from the snapshot), a {{step_N.result...}} reference to an earlier step, or "user request". Every input named in io.inputs must have a source here AND a matching concrete id / template in the step's actual args. No input may be implied by a previous step's prose.
- io.operation: HOW the data/media is used and what is being done to it on this step (the real action — e.g. "rewrite the third sentence", "combine the two product photos", "summarize the brain dump").
- io.output: WHAT this step produces — e.g. "new image asset", "updated sentence row", "new document", "document text for a later step", "web search results", or "nothing persisted".
- io.destination: WHERE the output goes — a concrete target id, a {{step_N.result.id}} (e.g. a create_document step), the Media Gallery, or "feeds step_M". It MUST match the mutating arg in args (document_id / target_document_id / media_id / source_media_id / etc.).
- io.capability: which tool/capability is used and WHY it is the right one (narrowest correct tool — follow the IMAGE TOOL DECISION GUIDE). This MUST equal the step's tool name.
- io.lookup: if you must look something up first, state exactly what to look up and what to do with the result; otherwise "none". If io.lookup is not "none", there MUST be an EARLIER step (find_* / read_document / web_search) and its result must be referenced via a {{step_N...}} template here — never act on a described-but-unresolved item.

SELF-CHECK before emitting each step: restate the step's target in one phrase, confirm its id is present in the WORKSPACE SNAPSHOT (or created/looked-up earlier in this plan), and confirm where the output lands. If you can't name the exact source id and the exact destination, the step is not ready — fix it or drop it. This is how you guarantee you are using the correct document and the output goes to the right place.

Return your output as JSON with this exact shape:
{
  "summary": "A one-or-two-sentence plain-language summary of what you'll do.",
  "steps": [
    {
      "tool": "<tool_name from the catalog>",
      "args": { ...arguments matching the tool's schema... },
      "io": {
        "inputs": "what data/media this step uses",
        "inputSource": "concrete id / {{step_N...}} / user request",
        "operation": "what is done to it",
        "output": "what is produced",
        "destination": "where the output goes (must match the args target)",
        "capability": "<same tool_name>",
        "lookup": "what to look up first, or 'none'"
      },
      "description": "A short plain-language sentence (naming the source and destination) that the user will see during approval."
    }
  ]
}

Filled example of one step:
{
  "tool": "add_sentence",
  "args": { "document_id": "{{step_0.result.id}}", "content": "Welcome to the trip plan." },
  "io": {
    "inputs": "the intro line text from the user's request",
    "inputSource": "user request",
    "operation": "append a new sentence to the bottom of the freshly created document",
    "output": "new sentence row",
    "destination": "the \"Trip Plan\" document created in step_0 ({{step_0.result.id}})",
    "capability": "add_sentence — adds one sentence to a known document",
    "lookup": "none"
  },
  "description": "Add the intro line to the new \"Trip Plan\" document."
}

If the user's request is impossible, ambiguous, or would require deletion, respond with:
{
  "summary": "I can't do that as described.",
  "steps": [],
  "explanation": "<one short sentence explaining why>"
}

Plain text only. No markdown, no code fences. Return the JSON object directly.`;


function buildLovablePrompt(plan: any, failedStep: any | null, errorMessage: string): string {
  return [
    "A plan in Orby failed. Please investigate.",
    "",
    `User's original request: ${plan.user_request}`,
    "",
    failedStep
      ? `Failed step ${plan.current_step + 1} of ${plan.total_steps}: ${failedStep.description}\nTool: ${failedStep.tool}\nArgs: ${JSON.stringify(failedStep.args, null, 2)}`
      : "The plan failed during composition (before any step executed).",
    "",
    `Error message: ${errorMessage}`,
    "",
    "Likely files to investigate:",
    "- supabase/functions/plan-compose/index.ts (if it failed during composition)",
    "- supabase/functions/plan-step/index.ts (if it failed during execution)",
    "- supabase/functions/_shared/tools.ts (the tool catalog and tool handlers)",
    "",
    "Please walk through the relevant code, propose a fix, and explain why it resolves the error. Show the diff with surrounding context.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { plan_id, user_id: bodyUserId, internal_secret, allowed_tool_groups } = body ?? {};
  if (typeof plan_id !== "string") return json({ error: "plan_id required" }, 400);
  const allowedGroups: string[] | null = Array.isArray(allowed_tool_groups)
    ? allowed_tool_groups.filter((g: unknown): g is string => typeof g === "string")
    : null;

  const PLAN_TICK_SECRET = Deno.env.get("PLAN_TICK_SECRET");
  const isInternal =
    !!PLAN_TICK_SECRET &&
    internal_secret === PLAN_TICK_SECRET &&
    typeof bodyUserId === "string";

  let userId: string;
  if (isInternal) {
    userId = bodyUserId;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    userId = userData.user.id;
  }
  const user = { id: userId };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: plan, error: planErr } = await admin
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .single();
  if (planErr || !plan) return json({ error: "plan not found" }, 404);
  if (plan.status !== "composing") return json({ error: `plan is ${plan.status}, not composing` }, 409);


  try {
    // ---- Build a WORKSPACE SNAPSHOT so the planner can resolve doc/media
    //      references naturally without having to call find_* tools or guess
    //      sentence wording.
    //
    // INDEPENDENCE RULE: We deliberately do NOT inject the user's currently
    // open document or current sentence position into the planner. Plans must
    // be independent of editor state — if the user wants to act on a specific
    // doc/sentence, they will describe it in their request (fuzzy-matched
    // against the snapshot below). This avoids the planner silently mutating
    // whatever happened to be open when the prompt was sent.
    //
    // SECURITY / ISOLATION NOTE: the planner prompt is rebuilt from scratch on
    // every call. The only cross-request inputs are (1) the user's current
    // request and (2) this snapshot, which is read live from the user's own
    // rows in `documents`, `sentences`, and `media_assets` (filtered by
    // `user_id`). We deliberately do NOT inject prior plan rows, prior LLM
    // outputs, or any other plan's `steps` JSON.


    // Full list of documents (id + title)
    const { data: allDocs } = await admin
      .from("documents").select("id, title, updated_at")
      .eq("user_id", user.id).order("updated_at", { ascending: false }).limit(2000);
    const docList = allDocs ?? [];

    // Token-based relevance scoring so we inline the docs the user plausibly
    // referenced even when the wording doesn't match the title verbatim.
    const STOP = new Set([
      "the", "a", "an", "of", "to", "and", "or", "with", "for", "this", "that",
      "these", "those", "my", "is", "it", "in", "on", "at", "by", "as", "be",
      "doc", "docs", "document", "documents", "note", "notes", "file", "files",
      "sentence", "sentences", "line", "lines", "row", "entry", "item",
      "about", "regarding", "called", "named", "titled", "list", "any", "some",
      "image", "images", "photo", "photos", "picture", "pic", "pics",
      "reference", "ref", "video", "videos", "audio", "clip",
    ]);
    // Emoji-aware: translate emoji-name phrases ("blue circle" -> 🔵) in the
    // request, then keep word tokens AND emoji glyphs AND any shortcode.
    const tokenize = (s: string): string[] => tokenizeRich(applyEmojiSynonyms(s), STOP);
    const reqTokens = tokenize(plan.user_request ?? "");
    const reqLower = applyEmojiSynonyms(plan.user_request ?? "").toLowerCase();
    const scoreText = (text: string): number => {
      const hay = String(text ?? "").toLowerCase();
      const hayTokens = new Set(tokenizeRich(String(text ?? "")));
      let score = 0;
      if (hay && reqLower.includes(hay)) score += 3;
      for (const t of reqTokens) {
        if (/[a-z0-9]/i.test(t) && hay.includes(t)) score += 2;
        if (hayTokens.has(t)) score += 2;
      }
      return score;
    };

    const scoredDocs = docList.map((d: any) => ({
      d,
      score: scoreText(String(d.title ?? "")),
    }));
    scoredDocs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.d.updated_at ?? "").localeCompare(String(a.d.updated_at ?? ""));
    });
    const forcedDocIds: string[] = Array.isArray((plan as any).attached_document_ids)
      ? (plan as any).attached_document_ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
    const forcedSet = new Set(forcedDocIds);

    // ISOLATION: only inline a document's FULL TEXT when it is *genuinely*
    // referenced by the current request — not merely sharing one loose word
    // with it. A single generic token overlap (e.g. "video", "image",
    // "part") used to drag in unrelated docs from prior plans. Require either
    // a phrase/substring hit OR 2+ distinct meaningful token matches.
    const reqTokenSet = new Set(reqTokens);
    const strongDocMatch = (title: string): boolean => {
      const hay = String(title ?? "").toLowerCase().trim();
      if (!hay) return false;
      // The whole title appears verbatim inside the request → strong signal.
      if (hay.length >= 4 && reqLower.includes(hay)) return true;
      // Emoji-aware token overlap: emoji glyphs and shortcodes count too.
      const hayTokens = new Set(tokenizeRich(String(title ?? "")));
      let distinct = 0;
      for (const t of reqTokenSet) {
        if (hayTokens.has(t)) {
          distinct += 1;
          if (distinct >= 2) return true;
        }
      }
      return false;
    };

    const scoreInlineIds = scoredDocs
      .filter(({ d }) => strongDocMatch(String(d.title ?? "")))
      .slice(0, 12)
      .map(({ d }) => d.id)
      .filter((id) => !forcedSet.has(id));

    // Final inline order: forced attachments first, then score-derived matches.
    const inlineIds = [...forcedDocIds, ...scoreInlineIds];
    const docById = new Map(docList.map((d: any) => [d.id, d]));

    const inlineDoc = async (id: string): Promise<string | null> => {
      // For forced ids the doc may not be in docList if it's outside the
      // 200-most-recent window — fetch the title directly in that case.
      let d: any = docById.get(id);
      if (!d) {
        const { data } = await admin
          .from("documents").select("id, title")
          .eq("id", id).eq("user_id", user.id).maybeSingle();
        if (!data) return null;
        d = data;
      }
      const { data: sents } = await admin
        .from("sentences").select("id, order_index, content")
        .eq("document_id", id).eq("user_id", user.id)
        .order("order_index", { ascending: true }).limit(200);
      const rows = sents ?? [];
      let total = 0;
      const lines: string[] = [];
      let truncated = false;
      for (const s of rows) {
        const line = `    [${s.order_index}] id=${s.id}  ${JSON.stringify(s.content ?? "")}`;
        if (total + line.length > 8000) { truncated = true; break; }
        lines.push(line);
        total += line.length;
      }
      return `  document_id: ${id}\n  title: ${JSON.stringify(d.title ?? "")}\n  sentences (${rows.length}${truncated ? ", truncated" : ""}):\n${lines.join("\n")}`;
    };

    const inlinedDocSections: string[] = [];
    for (const id of inlineIds) {
      const section = await inlineDoc(id);
      if (section) inlinedDocSections.push(section);
    }

    // Build a short attachments header (id — title) for the planner. Titles
    // come from docById when available, otherwise from a direct fetch above
    // (already loaded into the section text).
    const attachmentsHeader = forcedDocIds.length
      ? forcedDocIds.map((id) => {
          const d: any = docById.get(id);
          const title = d?.title ?? "(attached document)";
          return `  ${id} — ${JSON.stringify(title)}`;
        }).join("\n")
      : "";

    // Media assets — fetch then rank by token overlap with the request so the
    // most plausible candidates surface first in the snapshot.
    const { data: allMedia } = await admin
      .from("media_assets").select("id, title, kind, generation_params, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(2000);
    const mediaScored = (allMedia ?? []).map((m: any) => {
      const src = String(m?.generation_params?.user_text ?? "");
      const score = scoreText(`${String(m.title ?? "")} ${src}`);
      return { m, score };
    });
    mediaScored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.m.created_at ?? "").localeCompare(String(a.m.created_at ?? ""));
    });
    // ISOLATION (the #1 source of "old images coming back" on repeated /
    // scheduled runs): we must NOT put prior-plan media in front of the planner
    // unless THIS request genuinely operates on an existing asset.
    //
    // The old code surfaced any media with score > 0 and, worse, fell back to
    // the 25 most-recent assets when nothing matched. A schedule like
    // "generate a cat image" then self-matched its own previous output ("cat")
    // every run, so the planner kept calling regenerate_image / remix_images on
    // stale ids instead of generating fresh. We now:
    //   1. NEVER fall back to the whole library, and
    //   2. only surface media when the request shows REUSE INTENT (it wants to
    //      operate on existing media) or explicitly attached something, and even
    //      then require a STRONG match (mirroring strongDocMatch for docs).
    const MEDIA_LIST_CAP = 25;

    // Reuse intent: words/phrases that imply acting on an EXISTING asset rather
    // than creating something brand new.
    const reuseIntent =
      forcedDocIds.length > 0 ||
      /\b(regenerate|re-?generate|remix|edit|animate|upscale|variation|variant|recreate|modify|change|update|combine|merge|turn\s+.*\s+into|the\s+\w+\s+(image|photo|picture|pic|video|clip)|this\s+(image|photo|picture|video|clip)|that\s+(image|photo|picture|video|clip)|existing|previous|same)\b/.test(
        reqLower,
      );

    // Strong media match: phrase/substring hit OR 2+ distinct meaningful token
    // matches against the asset's title + source_text. Generic single-token
    // overlap (e.g. "image") no longer drags in unrelated prior output.
    const strongMediaMatch = (m: any): boolean => {
      const title = String(m?.title ?? "").toLowerCase().trim();
      const src = String(m?.generation_params?.user_text ?? "").toLowerCase().trim();
      if (title && title.length >= 4 && reqLower.includes(title)) return true;
      if (src && src.length >= 6 && reqLower.includes(src)) return true;
      const hayTokens = new Set(
        `${title} ${src}`.split(/[^a-z0-9]+/i).filter((t) => t.length >= 2),
      );
      let distinct = 0;
      for (const t of reqTokenSet) {
        if (hayTokens.has(t)) {
          distinct += 1;
          if (distinct >= 2) return true;
        }
      }
      return false;
    };

    const totalMedia = (allMedia ?? []).length;
    const relevantMedia = reuseIntent
      ? mediaScored.filter(({ m }) => strongMediaMatch(m)).map(({ m }) => m)
      : [];
    const mediaList = relevantMedia.slice(0, MEDIA_LIST_CAP).map((m: any) => ({
      id: m.id, title: m.title, kind: m.kind,
      source_text: m?.generation_params?.user_text ?? null,
    }));
    const mediaTruncated = relevantMedia.length > mediaList.length;

    // Bulk intent: requests like "act on ALL/EVERY doc matching X" need the
    // full document list presented as actionable. Otherwise the doc list is a
    // lookup catalog only — for resolving references, NOT a to-do list.
    const bulkIntent =
      /\b(all|every|each)\b/.test(reqLower) &&
      /\b(doc|docs|document|documents|matching|named|titled|start|begin|contain)/.test(reqLower);

    let userContext = "";
    if (attachmentsHeader) {
      userContext += `\n\nATTACHED DOCUMENTS (the user explicitly attached these to the request — treat their contents as primary input even if the request text is short. Their full text is inlined under REFERENCED DOCUMENTS below):\n${attachmentsHeader}`;
    }
    if (docList.length) {
      const docLabel = bulkIntent
        ? `ALL DOCUMENTS (id — title — parsed emoji/code) — the request asks to act on every matching document, so enumerate matches from THIS list`
        : `DOCUMENT CATALOG (id — title — parsed emoji/code) — a LOOKUP TABLE ONLY for resolving documents the request explicitly names or describes. Do NOT act on a document just because it appears here; if the request doesn't reference it, ignore it`;
      const renderDoc = (d: any): string => {
        const title = d.title ?? "";
        const emoji = leadingEmoji(title);
        const sc = extractShortcode(title);
        const meta = [emoji ? `emoji=${emoji}` : null, sc ? `code=${sc.raw}` : null]
          .filter(Boolean).join(", ");
        return `  ${d.id} — ${JSON.stringify(title)}${meta ? `  (${meta})` : ""}`;
      };
      userContext += `\n\n${docLabel}:\n${docList.map(renderDoc).join("\n")}`;
    }
    if (inlinedDocSections.length) {
      userContext += `\n\nREFERENCED DOCUMENTS (full contents inlined — use these ids and content directly, do NOT call find_document_by_title or find_sentence_by_content for them):\n${inlinedDocSections.join("\n\n")}`;
    }
    // MEDIA CATALOG — every media asset (id — kind — title — src), exactly like
    // the DOCUMENT CATALOG. This is what lets the planner LOOSELY match images,
    // videos, and audio by description ("the sunset image" → an asset titled
    // "Golden hour over the bay") instead of being blind to the library. Framed
    // as a lookup table ONLY so it does NOT reintroduce stale-media auto-reuse:
    // the planner must not act on a catalog item the request doesn't reference.
    const mediaCatalog = (allMedia ?? []).map((m: any) => {
      const title = m.title ?? "";
      const emoji = leadingEmoji(title);
      const sc = extractShortcode(title);
      const meta = [emoji ? `emoji=${emoji}` : null, sc ? `code=${sc.raw}` : null]
        .filter(Boolean).join(", ");
      const src = m?.generation_params?.user_text ?? null;
      return `  ${m.id} — ${m.kind} — ${JSON.stringify(title)}${meta ? `  (${meta})` : ""}${src ? ` — src=${JSON.stringify(String(src).slice(0, 160))}` : ""}`;
    });
    if (mediaCatalog.length) {
      userContext += `\n\nMEDIA CATALOG (id — kind — title — parsed emoji/code — src) — a LOOKUP TABLE ONLY for resolving images/videos/audio the request explicitly names or describes${totalMedia > mediaCatalog.length ? ` (showing ${mediaCatalog.length} of ${totalMedia} most-recent assets; if the item you need isn't here, call find_media_by_title / find_all_media_by_title)` : ""}. Match LOOSELY: never require an exact title — pick the closest id by keywords, emoji, or words from its src prompt. Do NOT act on an asset just because it appears here; if the request doesn't reference it, ignore it (this list is mostly leftover output from unrelated past plans):\n${mediaCatalog.join("\n")}`;
    }
    if (mediaList.length) {
      userContext += `\n\nSTRONGLY-MATCHED MEDIA (assets this request appears to operate on directly — prefer these ids when the request references existing media${mediaTruncated ? `; showing ${mediaList.length} of ${relevantMedia.length} matches — if the item you need isn't here, call find_media_by_title` : ""}):\n${mediaList.map((m: any) => `  ${m.id} — ${m.kind} — ${JSON.stringify(m.title ?? "")}${m.source_text ? ` — src=${JSON.stringify(String(m.source_text).slice(0, 200))}` : ""}`).join("\n")}`;
    }


    const systemPrompt = buildSystemPrompt(allowedGroups);
    const effectiveSystemPrompt = userContext
      ? `${systemPrompt}\n\nWORKSPACE SNAPSHOT (the user's actual data right now — resolve references like "the Cameron inbox doc" or "the reference image" by fuzzy-matching titles/content/media here; if an id is present, use it directly and do NOT call a find_* tool for it; if a referenced document's sentences are inlined here, you may inline their text directly into later step args instead of calling read_document. This snapshot does NOT include any "current" doc or sentence — that concept does not exist for plans.):${userContext}`
      : systemPrompt;
    const raw = await callPlannerLLM(effectiveSystemPrompt, plan.user_request);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Planner returned non-JSON output");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("Planner returned malformed output");
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];

    const toolNames = new Set(TOOL_CATALOG.map((t) => t.name));

    // Required target/destination args per tool. A step that mutates or
    // references a specific resource MUST carry that resource's id (or a
    // {{step_N...}} template that resolves to it at runtime). This guarantees
    // a plan never ships having "lost the where".
    const REQUIRED_TARGET_ARGS: Record<string, string[]> = {
      add_sentence: ["document_id", "content"],
      update_sentence_content: ["sentence_id", "new_content"],
      move_sentence: ["sentence_id", "target_document_id"],
      link_sentence_to_document: ["sentence_id"],
      mark_sentence_for_deletion: ["sentence_id"],
      mark_document_for_deletion: ["document_id"],
      mark_media_for_deletion: ["media_id"],
      rename_document: ["document_id", "new_title"],
      rename_media: ["media_id", "new_title"],
      read_document: ["document_id"],
      regenerate_image: ["source_media_id"],
      remix_images: ["source_media_ids"],
      image_to_video: ["source_media_id"],
      video_to_video: ["source_image_id", "reference_video_id"],
      audio_image_to_video: ["source_image_id", "audio_media_id"],
    };

    // A value "carries the where" if it's a non-blank string/value OR a
    // {{step_N...}} template that resolves at execution time.
    const hasTargetValue = (v: unknown): boolean => {
      if (v == null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (typeof v === "number" || typeof v === "boolean") return true;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    };

    for (const [i, s] of steps.entries()) {
      if (!s || typeof s !== "object") throw new Error(`Step ${i + 1} is malformed`);
      if (typeof s.tool !== "string" || !toolNames.has(s.tool)) {
        throw new Error(`Step ${i + 1} uses unknown tool: ${s.tool}`);
      }
      if (!s.args || typeof s.args !== "object") s.args = {};

      const required = REQUIRED_TARGET_ARGS[s.tool];
      if (required) {
        for (const argName of required) {
          if (!hasTargetValue(s.args[argName])) {
            throw new Error(
              `Step ${i + 1} (${s.tool}) is missing a target "${argName}". Every step must carry its destination explicitly — set it to a concrete id from the workspace or a {{step_N.result.id}} template.`,
            );
          }
        }
      }

      // PER-STEP REASONING CONTRACT — enforce the io object so the planner has
      // explicitly thought through what data it uses, how, what it outputs, and
      // where the output goes. A step without complete reasoning is rejected at
      // compose time rather than running wrong.
      const io = s.io;
      const ioRequired = ["inputs", "inputSource", "operation", "output", "destination", "capability"];
      if (!io || typeof io !== "object" || Array.isArray(io)) {
        throw new Error(
          `Step ${i + 1} (${s.tool}) is missing its "io" reasoning object. Every step must declare inputs, inputSource, operation, output, destination, and capability.`,
        );
      }
      for (const f of ioRequired) {
        if (typeof io[f] !== "string" || !io[f].trim()) {
          throw new Error(
            `Step ${i + 1} (${s.tool}) has an empty io.${f}. State concretely what data is used, how it's transformed, what is produced, and where it goes.`,
          );
        }
      }
      if (typeof io.lookup !== "string" || !io.lookup.trim()) io.lookup = "none";
      // capability must name the actual tool used on this step.
      if (!io.capability.includes(s.tool)) {
        throw new Error(
          `Step ${i + 1} io.capability ("${io.capability}") must reference the step's tool "${s.tool}".`,
        );
      }

      if (typeof s.description !== "string" || !s.description.trim()) {
        s.description = `${io.operation} → ${io.destination}`.slice(0, 240);
      }
      s.status = "pending";
      s.result = null;
      s.error = null;
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation : null;

    // Scheduled plans (those originating from a plan_schedule) auto-approve so
    // they run without a manual approval step — matching how regular plans
    // behave. Refusals (no steps) still go to 'proposed' so the user sees them.
    const isScheduled = (!!(plan as any).schedule_id || !!(plan as any).thread_id) && steps.length > 0;

    // Never revive a plan the user stopped mid-compose: skip the write if the
    // plan was cancelled while we were composing.
    await admin
      .from("plans")
      .update({
        status: isScheduled ? "approved" : "proposed",
        ...(isScheduled ? { approved_at: new Date().toISOString() } : {}),
        plan_summary: explanation ? `${summary}\n\n${explanation}` : summary,
        steps,
        total_steps: steps.length,
      })
      .eq("id", plan_id)
      .neq("status", "cancelled");

    return json({ ok: true, summary, step_count: steps.length });
  } catch (err: any) {
    await admin
      .from("plans")
      .update({
        status: "failed",
        error_message: String(err?.message ?? err ?? "compose failed"),
        error_lovable_prompt: buildLovablePrompt(plan, null, String(err?.message ?? err)),
      })
      .eq("id", plan_id);
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
