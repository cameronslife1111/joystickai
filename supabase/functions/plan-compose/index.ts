import { createClient } from "npm:@supabase/supabase-js@^2.45.0";
import { TOOL_CATALOG, toolCatalogForPrompt } from "../_shared/tools.ts";

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

const systemPrompt = `You are Orby's planner. The user describes something they want done; you produce a step-by-step plan that uses ONLY the tools listed below.

You have these tools (no others exist):

${toolCatalogForPrompt()}

Critical rules:
- You CANNOT delete user data. There is no delete tool. To "remove" something, use the appropriate mark_*_for_deletion tool, which only prepends the wastebasket emoji to the title or content so the user can find and remove it manually.
- PLAN INDEPENDENCE — there is NO "current document" and NO "current sentence". You are NOT told which doc the user has open or where their cursor is, and you must not assume one. Every target doc/sentence must come from the user's request itself, resolved fuzzily against the WORKSPACE SNAPSHOT below.
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
- create_document and add_sentence return objects with at least an "id" field.
- BULK / "ALL MATCHING" REQUESTS: When the user asks you to act on EVERY document matching a description (e.g. "all the docs that start with Ricky - Prompt", "every meme prompt doc", "all documents about X"), enumerate the matching titles DIRECTLY from the ALL DOCUMENTS (id — title) list in the WORKSPACE SNAPSHOT and emit one step per match (e.g. one add_sentence per matching title, with the literal title text inlined). The ALL DOCUMENTS list contains the user's complete document set — there is NO five-result limit when you read titles from the snapshot, so match loosely (prefix/substring/keywords) and include EVERY doc that fits, not just a few. Do NOT call find_document_by_title for this — it only returns the 5 best matches and cannot enumerate. Only if the matching set is clearly larger than what the snapshot shows, use find_documents_by_title (plural) which returns all matches.
- Plan as few steps as possible. Combine where reasonable — BUT for bulk "act on all matching docs" requests, one step per matching document is correct and expected (do not artificially limit the count).

Return your output as JSON with this exact shape:
{
  "summary": "A one-or-two-sentence plain-language summary of what you'll do.",
  "steps": [
    {
      "tool": "<tool_name from the catalog>",
      "args": { ...arguments matching the tool's schema... },
      "description": "A short plain-language sentence describing this step that the user will see during approval."
    }
  ]
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
  const { plan_id, user_id: bodyUserId, internal_secret } = body ?? {};
  if (typeof plan_id !== "string") return json({ error: "plan_id required" }, 400);

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
    const tokenize = (s: string): string[] =>
      String(s ?? "").toLowerCase().split(/[^a-z0-9]+/i)
        .filter((t) => t.length >= 2 && !STOP.has(t));
    const reqTokens = tokenize(plan.user_request ?? "");
    const reqLower = (plan.user_request ?? "").toLowerCase();
    const scoreText = (text: string): number => {
      const hay = String(text ?? "").toLowerCase();
      const hayTokens = new Set(hay.split(/[^a-z0-9]+/i).filter((t) => t.length >= 2));
      let score = 0;
      if (hay && reqLower.includes(hay)) score += 3;
      for (const t of reqTokens) {
        if (hay.includes(t)) score += 2;
        if (hayTokens.has(t)) score += 1;
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

    const scoreInlineIds = scoredDocs
      .filter(({ score }) => score > 0)
      .slice(0, 6)
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
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(200);
    const mediaScored = (allMedia ?? []).map((m: any) => {
      const src = String(m?.generation_params?.user_text ?? "");
      const score = scoreText(`${String(m.title ?? "")} ${src}`);
      return { m, score };
    });
    mediaScored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.m.created_at ?? "").localeCompare(String(a.m.created_at ?? ""));
    });
    const mediaList = mediaScored.map(({ m }) => ({
      id: m.id, title: m.title, kind: m.kind,
      source_text: m?.generation_params?.user_text ?? null,
    }));

    let userContext = "";
    if (attachmentsHeader) {
      userContext += `\n\nATTACHED DOCUMENTS (the user explicitly attached these to the request — treat their contents as primary input even if the request text is short. Their full text is inlined under REFERENCED DOCUMENTS below):\n${attachmentsHeader}`;
    }
    if (docList.length) {
      userContext += `\n\nALL DOCUMENTS (id — title):\n${docList.map((d: any) => `  ${d.id} — ${JSON.stringify(d.title ?? "")}`).join("\n")}`;
    }
    if (inlinedDocSections.length) {
      userContext += `\n\nREFERENCED DOCUMENTS (full contents inlined — use these ids and content directly, do NOT call find_document_by_title or find_sentence_by_content for them):\n${inlinedDocSections.join("\n\n")}`;
    }
    if (mediaList.length) {
      userContext += `\n\nALL MEDIA (id — kind — title — source_text, ranked by relevance to the request):\n${mediaList.map((m: any) => `  ${m.id} — ${m.kind} — ${JSON.stringify(m.title ?? "")}${m.source_text ? ` — src=${JSON.stringify(String(m.source_text).slice(0, 200))}` : ""}`).join("\n")}`;
    }


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
    for (const [i, s] of steps.entries()) {
      if (!s || typeof s !== "object") throw new Error(`Step ${i + 1} is malformed`);
      if (typeof s.tool !== "string" || !toolNames.has(s.tool)) {
        throw new Error(`Step ${i + 1} uses unknown tool: ${s.tool}`);
      }
      if (!s.args || typeof s.args !== "object") s.args = {};
      if (typeof s.description !== "string" || !s.description.trim()) {
        s.description = `Run ${s.tool}`;
      }
      s.status = "pending";
      s.result = null;
      s.error = null;
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation : null;

    await admin
      .from("plans")
      .update({
        status: "proposed",
        plan_summary: explanation ? `${summary}\n\n${explanation}` : summary,
        steps,
        total_steps: steps.length,
      })
      .eq("id", plan_id);

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
