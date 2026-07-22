import { createClient } from "npm:@supabase/supabase-js@^2.45.0";
import { TOOL_CATALOG, toolCatalogForPrompt } from "../_shared/tools.ts";
import { applyEmojiSynonyms, tokenizeRich } from "../_shared/lookup.ts";
import { nextRunAt, type Cadence, type ScheduleSpec } from "../_shared/recurrence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TRASH = "\u{1F5D1}\u{FE0F}";

// Invokes a sibling Supabase Edge Function. In user mode the user's JWT comes
// in via the `supabase` client. In internal (cron tick) mode we POST directly
// to the function URL with the service role token + a shared secret + user_id,
// so the receiver can recover the user identity without a JWT.
async function invokeEdgeFunction(
  supabase: any,
  functionName: string,
  body: any,
  ctx?: { internal?: boolean; user_id?: string },
) {
  if (ctx?.internal) {
    const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        ...body,
        internal_secret: PLAN_TICK_SECRET,
        user_id: ctx.user_id,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`${functionName} failed: ${res.status} ${txt.slice(0, 400)}`);
    }
    return;
  }
  const { error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    throw new Error(`${functionName} failed: ${error.message ?? String(error)}`);
  }
}

// ---- Runtime plan expansion (expand_plan) ----
const PLANNER_PROVIDER = Deno.env.get("PLANNER_PROVIDER") ?? "openai";
const PLANNER_MODEL = Deno.env.get("PLANNER_MODEL") ?? "gpt-5.5";
const MAX_EXPANSION_STEPS = 120;

async function callExpansionLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  if (PLANNER_PROVIDER !== "openai") throw new Error(`Unknown PLANNER_PROVIDER: ${PLANNER_PROVIDER}`);
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
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// Compact live snapshot for the expansion LLM: every doc title (id — title) and
// recent media (id — kind — title). Lets the AI target real ids when it writes
// per-item steps (e.g. which reference image to remix).
async function buildExpansionSnapshot(admin: any, userId: string): Promise<string> {
  const { data: docs } = await admin
    .from("documents").select("id, title")
    .eq("user_id", userId).order("updated_at", { ascending: false }).limit(2000);
  const { data: media } = await admin
    .from("media_assets").select("id, title, kind, generation_params")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  const docLines = (docs ?? []).map((d: any) => `  ${d.id} — ${JSON.stringify(d.title ?? "")}`).join("\n");
  const mediaLines = (media ?? []).map((m: any) => {
    const src = m?.generation_params?.user_text ?? null;
    return `  ${m.id} — ${m.kind} — ${JSON.stringify(m.title ?? "")}${src ? ` — src=${JSON.stringify(String(src).slice(0, 120))}` : ""}`;
  }).join("\n");
  let out = "";
  if (docLines) out += `\n\nDOCUMENT CATALOG (id — title):\n${docLines}`;
  if (mediaLines) out += `\n\nMEDIA (id — kind — title — src):\n${mediaLines}`;
  return out;
}

// Validate generated sub-steps with the same target-arg rules the composer uses.
function validateExpansionSteps(rawSteps: any[]): any[] {
  const toolNames = new Set(TOOL_CATALOG.map((t) => t.name));
  const REQUIRED: Record<string, string[]> = {
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
    create_schedule: ["title", "user_request", "cadence"],
    update_schedule: ["schedule_id"],
    delete_schedule: ["schedule_id"],
    toggle_schedule: ["schedule_id", "enabled"],
  };
  const has = (v: unknown) =>
    v != null && (typeof v === "string" ? v.trim().length > 0 : (Array.isArray(v) ? v.length > 0 : true));
  const out: any[] = [];
  for (const s of rawSteps) {
    if (!s || typeof s !== "object") continue;
    if (s.tool === "expand_plan") continue; // no recursive expansion
    if (typeof s.tool !== "string" || !toolNames.has(s.tool)) {
      throw new Error(`expand_plan produced an unknown tool: ${s.tool}`);
    }
    if (!s.args || typeof s.args !== "object") s.args = {};
    const req = REQUIRED[s.tool];
    if (req) for (const a of req) {
      if (!has(s.args[a])) throw new Error(`expand_plan step (${s.tool}) is missing target "${a}"`);
    }
    out.push({
      tool: s.tool,
      args: s.args,
      description: typeof s.description === "string" && s.description.trim() ? s.description : `Run ${s.tool}`,
      status: "pending",
      result: null,
      error: null,
    });
    if (out.length >= MAX_EXPANSION_STEPS) break;
  }
  return out;
}

const expansionSystemPrompt = `You expand ONE step of a running Orby plan into concrete sub-steps. The user's higher-level plan reached a point where it must do something "for each" item, and the items are only known now, from the CONTEXT below.

You have these tools (no others exist; do NOT emit expand_plan again):

${toolCatalogForPrompt()}

Rules:
- Read the CONTEXT (already-resolved document text / data) and the WORKSPACE SNAPSHOT, then emit one or a few real tool steps PER discovered item, in execution order.
- Every mutating/media step MUST carry its full target id in its own args — a concrete id from the snapshot, or a {{step_N.result.id}} template pointing at an EARLIER step.
- ABSOLUTE INDEXING: your first generated step will be inserted at index {{BASE_INDEX}}. So reference your own generated steps by their absolute index: the first is step {{BASE_INDEX}}, the next is {{BASE_INDEX_PLUS_1}}, and so on. You may also reference any already-completed earlier step by its absolute index if its result id is given to you.
- Image prompts must never exceed 3000 characters. Generate media one item at a time (one step per image).
- MEDIA MATCHING: resolve images/videos/audio LOOSELY against the MEDIA CATALOG — never require an exact title; pick the closest id by keywords, emoji, or words from its src prompt. Image tool choice: generate_image (new, no source), regenerate_image (one source + change), remix_images (combine 2-16 existing sources — resolve every source id first and pass them as a JSON array in source_media_ids). Never remix with fewer than 2 sources and never invent ids.
- Output STRICT JSON only: {"steps":[{"tool":"...","args":{...},"description":"..."}]}. No markdown, no fences.`;


function stringifyForTemplate(value: any, stepIdx: number, path: string): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return value.join("\n");
    if (
      value.every(
        (v) => v && typeof v === "object" && typeof (v as any).content === "string",
      )
    ) {
      return value.map((v: any) => v.content).join("\n");
    }
  }
  // Common single-string shapes: { text } (web_search, generate_text) and { content } (sentence rows).
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof (value as any).text === "string") return (value as any).text;
    if (typeof (value as any).content === "string") return (value as any).content;
  }
  throw new Error(
    `Template {{step_${stepIdx}.${path}}} resolved to a non-string ${
      Array.isArray(value) ? "array" : "object"
    }. Pipe a string field instead (e.g. {{step_${stepIdx}.result.text}} for read_document).`,
  );
}

function resolveTemplates(value: any, steps: any[]): any {
  if (typeof value === "string") {
    return value.replace(/\{\{step_(\d+)\.([^}]+)\}\}/g, (_, idxStr, path) => {
      const idx = parseInt(idxStr, 10);
      const src = steps[idx]?.result;
      if (src == null) {
        const tool = steps[idx]?.tool ?? "unknown";
        throw new Error(
          `Template {{step_${idx}.${path}}} cannot resolve: step_${idx} (${tool}) has no result yet.`,
        );
      }
      const resolved = resolvePath(src, path, idx, steps[idx]?.tool);
      return stringifyForTemplate(resolved, idx, path);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, steps));
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v, steps);
    return out;
  }
  return value;
}

function resolvePath(obj: any, path: string, stepIdx?: number, toolName?: string): any {
  const p = path.trim();
  const tokens: (string | number)[] = [];
  let i = 0;
  while (i < p.length) {
    if (p[i] === ".") { i++; continue; }
    if (p[i] === "[") {
      const end = p.indexOf("]", i);
      if (end < 0) throw new Error(`Bad path: ${path}`);
      tokens.push(parseInt(p.slice(i + 1, end), 10));
      i = end + 1;
    } else {
      let j = i;
      while (j < p.length && p[j] !== "." && p[j] !== "[") j++;
      tokens.push(p.slice(i, j));
      i = j;
    }
  }
  if (tokens[0] === "result") tokens.shift();
  const stepLabel = stepIdx != null ? `step_${stepIdx}${toolName ? ` (${toolName})` : ""}` : "step";
  let cur: any = obj;
  const walked: (string | number)[] = [];
  for (const t of tokens) {
    if (cur == null) {
      throw new Error(
        `Template {{step_${stepIdx}.${path}}} failed: ${stepLabel}.${walked.join(".") || "result"} is null/undefined, can't read "${t}".`,
      );
    }
    // Friendlier message when indexing past an empty/short array — the most common cause.
    if (typeof t === "number" && Array.isArray(cur) && t >= cur.length) {
      const hint = cur.length === 0
        ? `returned 0 results — the search probably didn't match anything.`
        : `returned ${cur.length} result(s), so index [${t}] is out of range.`;
      throw new Error(
        `Template {{step_${stepIdx}.${path}}} failed: ${stepLabel} ${hint}`,
      );
    }
    walked.push(t);
    cur = cur[t as any];
  }
  if (cur == null) {
    throw new Error(
      `Template {{step_${stepIdx}.${path}}} resolved to null. ${stepLabel}.${walked.join(".")} exists but has no value.`,
    );
  }
  return cur;
}


type ToolCtx = { user_id: string; admin: any; supabase: any };

// Stopwords shared across fuzzy search handlers. Intentionally small — just the
// connective tissue the user adds around a real reference ("the doc about X",
// "find a sentence about Y"). Real content words pass through.
const SEARCH_STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "with", "for", "this", "that",
  "these", "those", "my", "is", "it", "in", "on", "at", "by", "as", "be",
  "doc", "docs", "document", "documents", "note", "notes", "file", "files",
  "sentence", "sentences", "line", "lines", "row", "entry", "item",
  "about", "regarding", "called", "named", "titled", "list", "any", "some",
  "image", "images", "photo", "photos", "picture", "pic", "pics",
  "reference", "ref", "video", "videos", "audio", "clip",
]);

function tokenize(s: string): string[] {
  // Emoji-aware: translate emoji-name phrases ("blue circle" -> 🔵) first, then
  // keep word tokens AND emoji glyphs AND any shortcode (e.g. "x597").
  return tokenizeRich(applyEmojiSynonyms(s), SEARCH_STOPWORDS);
}

function scoreCandidate(haystack: string, query: string, qTokens: string[]): number {
  const hay = haystack.toLowerCase();
  // Rich token set of the candidate title — includes emoji glyphs + shortcode.
  const hayTokens = new Set(tokenizeRich(haystack));
  let score = 0;
  const fullQ = applyEmojiSynonyms(query.trim()).toLowerCase();
  if (fullQ && hay.includes(fullQ)) score += 3;
  for (const t of qTokens) {
    // Emoji/shortcode tokens are exact-match only (substring would be noisy).
    if (/[a-z0-9]/i.test(t) && hay.includes(t)) score += 2;
    if (hayTokens.has(t)) score += 2;
  }
  return score;
}

// fal's openai/gpt-image-2/edit endpoint returns 422 Unprocessable Entity when
// the prompt is too long (observed around ~4k+ chars, especially with multiple
// reference images). Planners often pipe entire continuity packages into the
// prompt via {{step_N.result}} templates — cap defensively so we degrade to a
// truncated prompt instead of a hard failure with no recovery.
const MAX_EDIT_PROMPT_CHARS = 3500;
function capEditPrompt(prompt: string): string {
  if (prompt.length <= MAX_EDIT_PROMPT_CHARS) return prompt;
  return prompt.slice(0, MAX_EDIT_PROMPT_CHARS - 20).trimEnd() + " …[truncated]";
}

// Shared fuzzy media lookup used by find_media_by_title (top 5) and
// find_all_media_by_title (enumerate all). Mirrors the document lookup:
// emoji- and shortcode-aware token scoring across the title AND the original
// generation prompt, best match first.
async function findMediaMatches(
  args: any,
  { user_id, admin }: { user_id: string; admin: any },
): Promise<Array<{ id: string; title: string; kind: string; source_text: string | null }>> {
  const query = String(args.query ?? "").trim();
  if (!query) return [];
  const kindFilter = ["image", "video", "audio"].includes(String(args.kind))
    ? String(args.kind)
    : null;
  const qTokens = tokenize(query);

  // Pull a generous working set: token-OR ilike across title + source prompt,
  // falling back to recent media so we always have candidates to rank.
  const baseSelect = "id, title, kind, generation_params, created_at";
  const runQuery = async (useOr: boolean) => {
    let q = admin.from("media_assets").select(baseSelect).eq("user_id", user_id);
    if (kindFilter) q = q.eq("kind", kindFilter);
    if (useOr && qTokens.length > 0) {
      const orFilter = qTokens
        .flatMap((t) => [`title.ilike.%${t}%`, `generation_params->>user_text.ilike.%${t}%`])
        .join(",");
      q = q.or(orFilter);
    }
    const { data } = await q.order("created_at", { ascending: false }).limit(2000);
    return (data ?? []) as any[];
  };

  let rows = qTokens.length > 0 ? await runQuery(true) : [];
  if (rows.length === 0) rows = await runQuery(false);
  if (rows.length === 0) return [];

  const scored = rows
    .map((m: any) => {
      const hay = `${String(m.title ?? "")} ${String(m?.generation_params?.user_text ?? "")}`;
      return { m, score: scoreCandidate(hay, query, qTokens) };
    })
    .filter(({ score }) => score > 0);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.m.created_at ?? "").localeCompare(String(a.m.created_at ?? ""));
  });
  return scored.map(({ m }) => ({
    id: m.id,
    title: m.title,
    kind: m.kind,
    source_text: m?.generation_params?.user_text ?? null,
  }));
}

const TOOL_HANDLERS: Record<string, any> = {
  async find_document_by_title(args, { user_id, admin }) {
    const query = String(args.query ?? "").trim();
    const qTokens = tokenize(query);
    // Pull a bounded working set. Try a token-OR ilike first, fall back to
    // recent docs so we always have candidates to rank.
    let docs: any[] = [];
    if (qTokens.length > 0) {
      const orFilter = qTokens.map((t) => `title.ilike.%${t}%`).join(",");
      const { data } = await admin
        .from("documents")
        .select("id, title, updated_at")
        .eq("user_id", user_id)
        .or(orFilter)
        .order("updated_at", { ascending: false })
        .limit(200);
      docs = data ?? [];
    }
    if (docs.length === 0) {
      const { data } = await admin
        .from("documents")
        .select("id, title, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(200);
      docs = data ?? [];
    }
    if (docs.length === 0) return [];
    const scored = docs.map((d: any) => ({
      d,
      score: scoreCandidate(String(d.title ?? ""), query, qTokens),
    }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.d.updated_at ?? "").localeCompare(String(a.d.updated_at ?? ""));
    });
    return scored.slice(0, 5).map(({ d }) => ({ id: d.id, title: d.title }));
  },
  async find_documents_by_title(args, { user_id, admin }) {
    const query = String(args.query ?? "").trim();
    const rawLimit = Number(args.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 100;
    const qTokens = tokenize(query);
    // Pull a generous working set so bulk enumeration sees every match.
    let docs: any[] = [];
    if (qTokens.length > 0) {
      const orFilter = qTokens.map((t) => `title.ilike.%${t}%`).join(",");
      const { data } = await admin
        .from("documents")
        .select("id, title, updated_at")
        .eq("user_id", user_id)
        .or(orFilter)
        .order("updated_at", { ascending: false })
        .limit(2000);
      docs = data ?? [];
    }
    if (docs.length === 0) {
      const { data } = await admin
        .from("documents")
        .select("id, title, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(2000);
      docs = data ?? [];
    }
    if (docs.length === 0) return [];
    const scored = docs
      .map((d: any) => ({ d, score: scoreCandidate(String(d.title ?? ""), query, qTokens) }))
      .filter(({ score }) => score > 0);
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.d.updated_at ?? "").localeCompare(String(a.d.updated_at ?? ""));
    });
    return scored.slice(0, limit).map(({ d }) => ({ id: d.id, title: d.title }));
  },
  async read_document(args, { user_id, admin }) {
    const { data: doc } = await admin
      .from("documents")
      .select("id, title")
      .eq("id", args.document_id)
      .eq("user_id", user_id)
      .maybeSingle();
    if (!doc) throw new Error(`Document ${args.document_id} not found`);
    const { data: sents } = await admin
      .from("sentences")
      .select("id, order_index, content")
      .eq("document_id", args.document_id)
      .eq("user_id", user_id)
      .order("order_index", { ascending: true });
    const rows = sents ?? [];
    return {
      id: doc.id,
      title: doc.title,
      text: rows.map((s: any) => s.content).join("\n"),
      sentences: rows,
    };
  },
  async find_sentence_by_content(args, { user_id, admin }) {
    const query = String(args.query ?? "").trim();
    const qTokens = tokenize(query);
    const baseSelect = "id, document_id, content, order_index, created_at";
    let rows: any[] = [];
    if (qTokens.length > 0) {
      const orFilter = qTokens.map((t) => `content.ilike.%${t}%`).join(",");
      let q = admin
        .from("sentences")
        .select(baseSelect)
        .eq("user_id", user_id)
        .or(orFilter)
        .order("created_at", { ascending: false })
        .limit(500);
      if (args.document_id) q = q.eq("document_id", args.document_id);
      const { data } = await q;
      rows = data ?? [];
    }
    if (rows.length === 0) {
      let q = admin
        .from("sentences")
        .select(baseSelect)
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (args.document_id) q = q.eq("document_id", args.document_id);
      const { data } = await q;
      rows = data ?? [];
    }
    if (rows.length === 0) return [];
    const scored = rows.map((r: any) => ({
      r,
      score: scoreCandidate(String(r.content ?? ""), query, qTokens),
    }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.r.created_at ?? "").localeCompare(String(a.r.created_at ?? ""));
    });
    return scored.slice(0, 5).map(({ r }) => ({
      id: r.id,
      document_id: r.document_id,
      content: r.content,
      order_index: r.order_index,
    }));
  },


  async find_media_by_title(args, { user_id, admin }) {
    const matches = await findMediaMatches(args, { user_id, admin });
    return matches.slice(0, 5);
  },
  async find_all_media_by_title(args, { user_id, admin }) {
    const rawLimit = Number(args.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 100;
    const matches = await findMediaMatches(args, { user_id, admin });
    return matches.slice(0, limit);
  },
  async expand_plan(args, { user_id, admin, baseIndex }: any) {
    const instruction = String(args.instruction ?? "").trim();
    const context = String(args.context ?? "").trim();
    if (!instruction) throw new Error("expand_plan requires an instruction");
    const base = Number.isFinite(baseIndex) ? Number(baseIndex) : 0;
    const snapshot = await buildExpansionSnapshot(admin, user_id);
    const sys = expansionSystemPrompt
      .replace(/\{\{BASE_INDEX_PLUS_1\}\}/g, String(base + 1))
      .replace(/\{\{BASE_INDEX\}\}/g, String(base));
    const userPrompt =
      `INSTRUCTION (do this for EACH discovered item):\n${instruction}\n\n` +
      `CONTEXT (derive the items from this):\n${context || "(none provided)"}\n` +
      `${snapshot}\n\nReturn JSON now. Your first generated step is index ${base}.`;
    const raw = await callExpansionLLM(sys, userPrompt);
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { throw new Error("expand_plan: AI returned non-JSON"); }
    const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    const steps = validateExpansionSteps(rawSteps);
    return { __expand_steps: steps, generated: steps.length };
  },
  async send_chat_message(args, { user_id, admin, thread_id, plan_id }: any) {
    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("send_chat_message requires text");
    if (!thread_id) throw new Error("send_chat_message is only available for plans started from a chat thread");
    const { error } = await admin.from("chat_messages").insert({
      user_id,
      thread_id,
      role: "assistant",
      content: text,
      kind: "text",
      plan_id: plan_id ?? null,
    });
    if (error) throw new Error(error.message);
    // Bump thread ordering so it floats up in the sidebar.
    await admin.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);
    return { posted: true, text };
  },
  async ask_user(args, { thread_id }: any) {
    const question = String(args.question ?? "").trim();
    if (!question) throw new Error("ask_user requires a question");
    if (!thread_id) throw new Error("ask_user is only available for plans started from a chat thread");
    const context = typeof args.context === "string" ? args.context.trim() : "";
    // Return the sentinel — the runner pauses the plan and posts the message.
    return { __ask_user: { question, context } };
  },
  async create_document(args, { user_id, admin }) {
    const { count } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id);
    const { data, error } = await admin
      .from("documents")
      .insert({ user_id, title: args.title, position: count ?? 0 })
      .select("id, title")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async rename_document(args, { user_id, admin }) {
    const { data, error } = await admin
      .from("documents")
      .update({ title: args.new_title })
      .eq("id", args.document_id)
      .eq("user_id", user_id)
      .select("id, title")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async add_sentence(args, { user_id, admin, supabase }) {
    const pos = args.position ?? "bottom";
    // Verify ownership of the target doc first so the error message is friendly.
    const { data: docRow } = await admin
      .from("documents")
      .select("id, current_sentence_index")
      .eq("id", args.document_id)
      .eq("user_id", user_id)
      .single();
    if (!docRow) throw new Error("Document not found");
    let insertAt = 0;
    if (pos === "top") {
      insertAt = 0;
    } else if (pos === "after_current") {
      insertAt = (docRow.current_sentence_index ?? -1) + 1;
    } else {
      const { count } = await admin
        .from("sentences")
        .select("id", { count: "exact", head: true })
        .eq("document_id", args.document_id);
      insertAt = count ?? 0;
    }
    // Atomic shift + insert. Use the SECURITY DEFINER `_as` variant via the
    // admin client so this works in background tick mode (no user JWT, so
    // auth.uid() is null and the original RPC raised "not authenticated").
    const { error: rpcErr } = await admin.rpc("insert_sentences_at_as", {
      p_user_id: user_id,
      p_document_id: args.document_id,
      p_contents: [args.content],
      p_insert_at: insertAt,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    const { data: ins, error: selErr } = await admin
      .from("sentences")
      .select("id, content, order_index")
      .eq("document_id", args.document_id)
      .eq("order_index", insertAt)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    return ins;
  },
  async update_sentence_content(args, { user_id, admin }) {
    const { data, error } = await admin
      .from("sentences")
      .update({ content: args.new_content })
      .eq("id", args.sentence_id)
      .eq("user_id", user_id)
      .select("id, content")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async move_sentence(args, { user_id, admin, supabase }) {
    const pos = args.position ?? "bottom";
    let insertAt = 0;
    if (pos === "top") {
      insertAt = 0;
    } else if (pos === "after_current") {
      const { data: doc } = await admin
        .from("documents")
        .select("current_sentence_index")
        .eq("id", args.target_document_id)
        .eq("user_id", user_id)
        .single();
      insertAt = (doc?.current_sentence_index ?? -1) + 1;
    } else {
      const { count } = await admin
        .from("sentences")
        .select("id", { count: "exact", head: true })
        .eq("document_id", args.target_document_id);
      insertAt = count ?? 0;
    }
    const { data: s } = await admin
      .from("sentences")
      .select("content")
      .eq("id", args.sentence_id)
      .eq("user_id", user_id)
      .maybeSingle();
    // Idempotency: if a prior (partial) run of this step already moved+deleted
    // the source, treat it as a no-op success instead of failing the plan.
    if (!s) {
      return { skipped: true, reason: "source sentence already moved or deleted" };
    }
    const inserted = await TOOL_HANDLERS.add_sentence(
      { document_id: args.target_document_id, content: s.content, position: pos === "top" ? "top" : (pos === "after_current" ? "after_current" : "bottom") },
      { user_id, admin, supabase },
    );
    const { error: delErr } = await admin
      .from("sentences")
      .delete()
      .eq("id", args.sentence_id)
      .eq("user_id", user_id);
    if (delErr) throw new Error(delErr.message);
    return { moved_to: args.target_document_id, position: insertAt, new_sentence: inserted };
  },
  async link_sentence_to_document(args, { user_id, admin }) {
    const target = args.target_document_id === null ? null : args.target_document_id;
    const { data, error } = await admin
      .from("sentences")
      .update({ linked_document_id: target })
      .eq("id", args.sentence_id)
      .eq("user_id", user_id)
      .select("id, linked_document_id")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async mark_sentence_for_deletion(args, { user_id, admin }) {
    const { data: cur } = await admin
      .from("sentences")
      .select("content")
      .eq("id", args.sentence_id)
      .eq("user_id", user_id)
      .single();
    if (!cur) throw new Error("Sentence not found");
    const next = cur.content.startsWith(TRASH) ? cur.content : `${TRASH}  ${cur.content}`;
    const { data, error } = await admin
      .from("sentences")
      .update({ content: next })
      .eq("id", args.sentence_id)
      .eq("user_id", user_id)
      .select("id, content")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async mark_document_for_deletion(args, { user_id, admin }) {
    const { data: cur } = await admin
      .from("documents")
      .select("title")
      .eq("id", args.document_id)
      .eq("user_id", user_id)
      .single();
    if (!cur) throw new Error("Document not found");
    const next = cur.title.startsWith(TRASH) ? cur.title : `${TRASH}  ${cur.title}`;
    const { data, error } = await admin
      .from("documents")
      .update({ title: next })
      .eq("id", args.document_id)
      .eq("user_id", user_id)
      .select("id, title")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async mark_media_for_deletion(args, { user_id, admin }) {
    const { data: cur } = await admin
      .from("media_assets")
      .select("title")
      .eq("id", args.media_id)
      .eq("user_id", user_id)
      .single();
    if (!cur) throw new Error("Media not found");
    const next = cur.title.startsWith(TRASH) ? cur.title : `${TRASH}  ${cur.title}`;
    const { data, error } = await admin
      .from("media_assets")
      .update({ title: next })
      .eq("id", args.media_id)
      .eq("user_id", user_id)
      .select("id, title")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async rename_media(args, { user_id, admin }) {
    const { data, error } = await admin
      .from("media_assets")
      .update({ title: args.new_title })
      .eq("id", args.media_id)
      .eq("user_id", user_id)
      .select("id, title")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async web_search(args, _ctx) {
    const apiKey = Deno.env.get("PERPLEXITY_API_KEY");
    if (!apiKey) throw new Error("Missing PERPLEXITY_API_KEY");
    const res = await fetch("https://api.perplexity.ai/v1/agent", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: "pro-search",
        input: args.query,
        tools: [{ type: "web_search" }],
        instructions: "Return concise prose. Plain text only. No markdown, no citation markers like [1].",
      }),
    });
    if (!res.ok) throw new Error(`Perplexity ${res.status}`);
    const data = await res.json();
    let text = "";
    if (Array.isArray(data?.output)) {
      for (const item of data.output) {
        if (item?.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
          }
        }
      }
    }
    text = text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\s+/g, " ").trim();
    return { text };
  },
  async generate_text(args, _ctx) {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
    const model = Deno.env.get("PLANNER_MODEL") ?? "gpt-5.5";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are Orby. Return concise prose. Plain text only. No markdown." },
          { role: "user", content: args.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { text };
  },

  // ----- Internal helpers used by media generation handlers -----
  async _load_media(admin: any, user_id: string, id: string, expectedKind: "image" | "video" | "audio") {
    const { data } = await admin
      .from("media_assets")
      .select("id, kind, status, url, title")
      .eq("id", id)
      .eq("user_id", user_id)
      .maybeSingle();
    if (!data) throw new Error(`Media asset ${id} not found`);
    if (data.kind !== expectedKind) {
      throw new Error(`Expected a ${expectedKind} asset, but ${id} is a ${data.kind}`);
    }
    if (data.status === "generating") {
      throw new Error(`Source media is still generating; cannot use it as input yet`);
    }
    if (!data.url) {
      throw new Error(`Source media has no URL`);
    }
    return data;
  },

  async generate_image(args, { user_id, admin, supabase, internal }) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required");
    const validSizes = ["portrait_16_9", "portrait_4_3", "square_hd", "landscape_4_3", "landscape_16_9"];
    const image_size = validSizes.includes(args.image_size) ? args.image_size : "portrait_16_9";
    const validQuality = ["low", "medium", "high"];
    const quality = validQuality.includes(args.quality) ? args.quality : "high";
    const validFormat = ["png", "jpeg", "webp"];
    const output_format = validFormat.includes(args.output_format) ? args.output_format : "png";

    const { data: row, error } = await admin
      .from("media_assets")
      .insert({
        user_id,
        title: prompt.slice(0, 60) || "Generated image",
        kind: "image",
        status: "generating",
        generation_params: {
          mode: "text-to-image",
          user_text: prompt,
          image_size, quality, output_format,
          origin: "plan",
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await invokeEdgeFunction(supabase, "generate-image", {
      row_id: row.id, prompt, image_size, quality, output_format,
    }, { internal, user_id });
    return { __pending_media: row.id };
  },

  async regenerate_image(args, { user_id, admin, supabase, internal }) {
    const prompt = capEditPrompt(String(args.prompt ?? "").trim());
    if (!prompt) throw new Error("prompt is required");
    const source = await TOOL_HANDLERS._load_media(admin, user_id, args.source_media_id, "image");

    // "auto" is rejected by fal openai/gpt-image-2/edit when multiple images
    // are passed and is unreliable for single-image edits — coerce it away.
    const validSizes = ["portrait_16_9", "portrait_4_3", "square_hd", "landscape_4_3", "landscape_16_9"];
    const requestedSize = args.image_size === "auto" ? "portrait_16_9" : args.image_size;
    const image_size = validSizes.includes(requestedSize) ? requestedSize : "portrait_16_9";
    const validQuality = ["low", "medium", "high"];
    const quality = validQuality.includes(args.quality) ? args.quality : "high";
    const validFormat = ["png", "jpeg", "webp"];
    const output_format = validFormat.includes(args.output_format) ? args.output_format : "png";

    const { data: row, error } = await admin
      .from("media_assets")
      .insert({
        user_id,
        title: prompt.slice(0, 60) || "Regenerated image",
        kind: "image",
        status: "generating",
        generation_params: {
          mode: "regenerate",
          source_asset_id: source.id,
          user_text: prompt,
          image_size, quality, output_format,
          origin: "plan",
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await invokeEdgeFunction(supabase, "edit-image", {
      row_id: row.id, prompt, image_urls: [source.url], image_size, quality, output_format,
    }, { internal, user_id });
    return { __pending_media: row.id };
  },

  async remix_images(args, { user_id, admin, supabase, internal }) {
    const prompt = capEditPrompt(String(args.prompt ?? "").trim());
    if (!prompt) throw new Error("prompt is required");

    let ids: string[] = [];
    const raw = args.source_media_ids;
    if (Array.isArray(raw)) ids = raw.map(String);
    else if (typeof raw === "string") {
      try { ids = JSON.parse(raw); } catch { throw new Error("source_media_ids must be a JSON array of UUIDs"); }
    }
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 16) {
      throw new Error("source_media_ids must contain 2 to 16 UUIDs");
    }
    const sources = await Promise.all(ids.map((id) => TOOL_HANDLERS._load_media(admin, user_id, id, "image")));

    // "auto" is rejected by fal openai/gpt-image-2/edit (422 Unprocessable
    // Entity) when multiple input images are supplied — coerce it to a real size.
    const validSizes = ["portrait_16_9", "portrait_4_3", "square_hd", "landscape_4_3", "landscape_16_9"];
    const requestedSize = args.image_size === "auto" ? "portrait_16_9" : args.image_size;
    const image_size = validSizes.includes(requestedSize) ? requestedSize : "portrait_16_9";
    const validQuality = ["low", "medium", "high"];
    const quality = validQuality.includes(args.quality) ? args.quality : "high";
    const validFormat = ["png", "jpeg", "webp"];
    const output_format = validFormat.includes(args.output_format) ? args.output_format : "png";

    const { data: row, error } = await admin
      .from("media_assets")
      .insert({
        user_id,
        title: prompt.slice(0, 60) || "Remixed image",
        kind: "image",
        status: "generating",
        generation_params: {
          mode: "remix",
          source_asset_ids: ids,
          user_text: prompt,
          image_size, quality, output_format,
          origin: "plan",
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await invokeEdgeFunction(supabase, "edit-image", {
      row_id: row.id, prompt, image_urls: sources.map((s) => s.url), image_size, quality, output_format,
    }, { internal, user_id });
    return { __pending_media: row.id };
  },

  async image_to_video(args, { user_id, admin, supabase, internal }) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required");
    const source = await TOOL_HANDLERS._load_media(admin, user_id, args.source_media_id, "image");
    let endImage: any = null;
    if (args.end_media_id) {
      endImage = await TOOL_HANDLERS._load_media(admin, user_id, args.end_media_id, "image");
    }
    let duration = typeof args.duration === "number" ? Math.round(args.duration) : 5;
    if (duration < 3) duration = 3;
    if (duration > 15) duration = 15;
    const generate_audio = typeof args.generate_audio === "boolean" ? args.generate_audio : false;
    const negative_prompt = typeof args.negative_prompt === "string" && args.negative_prompt.trim()
      ? args.negative_prompt : "blur, distort, and low quality";
    let cfg_scale = typeof args.cfg_scale === "number" ? args.cfg_scale : 0.5;
    if (cfg_scale < 0) cfg_scale = 0;
    if (cfg_scale > 1) cfg_scale = 1;

    const { data: row, error } = await admin
      .from("media_assets")
      .insert({
        user_id,
        title: prompt.slice(0, 60) || "Generated video",
        kind: "video",
        status: "generating",
        generation_params: {
          mode: "image-to-video",
          model: "kling-v3-pro-i2v",
          source_image_id: source.id,
          end_image_id: endImage?.id ?? null,
          duration, generate_audio, negative_prompt, cfg_scale,
          user_text: prompt,
          origin: "plan",
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await invokeEdgeFunction(supabase, "generate-kling-video", {
      row_id: row.id,
      mode: "i2v",
      prompt,
      image_url: source.url,
      end_image_url: endImage?.url ?? null,
      duration: String(duration),
      generate_audio,
      negative_prompt,
      cfg_scale,
    }, { internal, user_id });
    return { __pending_media: row.id };
  },

  async video_to_video(args, { user_id, admin, supabase, internal }) {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required");
    const sourceImage = await TOOL_HANDLERS._load_media(admin, user_id, args.source_image_id, "image");
    const refVideo = await TOOL_HANDLERS._load_media(admin, user_id, args.reference_video_id, "video");
    const character_orientation = args.character_orientation === "video" ? "video" : "image";
    const keep_original_sound = typeof args.keep_original_sound === "boolean" ? args.keep_original_sound : true;
    let elementImage: any = null;
    if (character_orientation === "video" && args.element_image_id) {
      elementImage = await TOOL_HANDLERS._load_media(admin, user_id, args.element_image_id, "image");
    }

    const { data: row, error } = await admin
      .from("media_assets")
      .insert({
        user_id,
        title: prompt.slice(0, 60) || "Generated video",
        kind: "video",
        status: "generating",
        generation_params: {
          mode: "video-to-video",
          model: "kling-v3-pro-motion-control",
          source_image_id: sourceImage.id,
          reference_video_id: refVideo.id,
          character_orientation, keep_original_sound,
          element_image_id: elementImage?.id ?? null,
          user_text: prompt,
          origin: "plan",
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await invokeEdgeFunction(supabase, "generate-kling-video", {
      row_id: row.id,
      mode: "v2v",
      prompt,
      image_url: sourceImage.url,
      video_url: refVideo.url,
      character_orientation,
      keep_original_sound,
      element_image_url: elementImage?.url ?? null,
    }, { internal, user_id });
    return { __pending_media: row.id };
  },

  async audio_image_to_video(args, { user_id, admin, supabase, internal }) {
    const sourceImage = await TOOL_HANDLERS._load_media(admin, user_id, args.source_image_id, "image");
    const audio = await TOOL_HANDLERS._load_media(admin, user_id, args.audio_media_id, "audio");
    const validTalking = ["stable", "expressive"];
    const talking_style = validTalking.includes(args.talking_style) ? args.talking_style : "stable";
    const validRes = ["360p", "480p", "540p", "720p", "1080p"];
    const resolution = validRes.includes(args.resolution) ? args.resolution : "1080p";
    const validAspect = ["9:16", "16:9", "1:1"];
    const aspect_ratio = validAspect.includes(args.aspect_ratio) ? args.aspect_ratio : "9:16";
    const caption = typeof args.caption === "boolean" ? args.caption : false;

    const { data: row, error } = await admin
      .from("media_assets")
      .insert({
        user_id,
        title: audio.title ? `${audio.title} (avatar)` : "Generated avatar video",
        kind: "video",
        status: "generating",
        generation_params: {
          mode: "audio-image-to-video",
          model: "heygen-avatar-v4",
          source_image_id: sourceImage.id,
          audio_asset_id: audio.id,
          talking_style, resolution, aspect_ratio, caption,
          origin: "plan",
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await invokeEdgeFunction(supabase, "generate-heygen-avatar", {
      row_id: row.id,
      image_url: sourceImage.url,
      audio_url: audio.url,
      talking_style, resolution, aspect_ratio, caption,
    }, { internal, user_id });
    return { __pending_media: row.id };
  },

  // ----- Plan schedules (create/edit/list/delete/toggle scheduled plans) -----
  async find_schedule_by_title(args, { user_id, admin }) {
    const query = String(args.query ?? "").trim();
    const qTokens = tokenize(query);
    const { data } = await admin
      .from("plan_schedules")
      .select("id, title, cadence, enabled, next_run_at")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = data ?? [];
    if (rows.length === 0) return [];
    const scored = rows
      .map((r: any) => ({ r, score: scoreCandidate(String(r.title ?? ""), query, qTokens) }))
      .filter(({ score }) => score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(({ r }) => r);
  },
  async list_schedules(_args, { user_id, admin }) {
    const { data, error } = await admin
      .from("plan_schedules")
      .select("id, title, cadence, interval_n, time_of_day, timezone, weekdays, month_days, year_month_days, starts_at, ends_at, max_runs, enabled, next_run_at, run_count")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  async create_schedule(args, { user_id, admin }) {
    const row = buildScheduleRow(args, {});
    // Enforce the same 50-schedule cap the UI enforces.
    const { count } = await admin
      .from("plan_schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id);
    if ((count ?? 0) >= 50) {
      throw new Error("You've hit the limit of 50 schedules. Delete one first.");
    }
    const spec: ScheduleSpec = { ...row, run_count: 0 } as ScheduleSpec;
    const next = nextRunAt(spec);
    if (!next) throw new Error("That schedule has no future fire time — pick a future date or different cadence.");
    const insert: any = {
      ...row,
      user_id,
      enabled: true,
      run_count: 0,
      next_run_at: next.toISOString(),
    };
    const { data, error } = await admin
      .from("plan_schedules")
      .insert(insert)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async update_schedule(args, { user_id, admin }) {
    const id = String(args.schedule_id ?? "").trim();
    if (!id) throw new Error("update_schedule requires schedule_id");
    const { data: existing, error: getErr } = await admin
      .from("plan_schedules")
      .select("*")
      .eq("id", id)
      .eq("user_id", user_id)
      .single();
    if (getErr || !existing) throw new Error(getErr?.message || "Schedule not found");
    const patch = buildScheduleRow(args, existing);
    if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
    const merged = { ...existing, ...patch };
    const next = nextRunAt({ ...merged, run_count: existing.run_count ?? 0 } as ScheduleSpec);
    const update: any = {
      ...patch,
      next_run_at: next ? next.toISOString() : null,
      enabled: next ? (patch.enabled ?? existing.enabled ?? true) : false,
    };
    const { data, error } = await admin
      .from("plan_schedules")
      .update(update)
      .eq("id", id)
      .eq("user_id", user_id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async delete_schedule(args, { user_id, admin }) {
    const id = String(args.schedule_id ?? "").trim();
    if (!id) throw new Error("delete_schedule requires schedule_id");
    const { error } = await admin
      .from("plan_schedules")
      .delete()
      .eq("id", id)
      .eq("user_id", user_id);
    if (error) throw new Error(error.message);
    return { ok: true, deleted_id: id };
  },
  async toggle_schedule(args, { user_id, admin }) {
    const id = String(args.schedule_id ?? "").trim();
    if (!id) throw new Error("toggle_schedule requires schedule_id");
    const enabled = args.enabled !== false;
    const { data: existing } = await admin
      .from("plan_schedules")
      .select("*")
      .eq("id", id)
      .eq("user_id", user_id)
      .single();
    if (!existing) throw new Error("Schedule not found");
    const patch: any = { enabled };
    if (enabled) {
      const next = nextRunAt({ ...existing, run_count: existing.run_count ?? 0 } as ScheduleSpec);
      patch.next_run_at = next ? next.toISOString() : null;
      if (!next) patch.enabled = false;
    }
    const { data, error } = await admin
      .from("plan_schedules")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user_id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async send_chat_message(args, { user_id, admin, thread_id, plan_id }) {
    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("send_chat_message requires text");
    if (!thread_id) throw new Error("send_chat_message: plan has no chat thread");
    const { error } = await admin.from("chat_messages").insert({
      user_id,
      thread_id,
      role: "assistant",
      content: text,
      kind: "text",
      plan_id: plan_id ?? null,
    });
    if (error) throw new Error(error.message);
    await admin.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread_id);
    return { posted: true };
  },
  async ask_user(args, { thread_id }) {
    const question = String(args.question ?? "").trim();
    if (!question) throw new Error("ask_user requires question");
    if (!thread_id) throw new Error("ask_user: plan has no chat thread");
    // Sentinel — the main runner handles the pause/insert; we just return it.
    return { __ask_user: { question, context: String(args.context ?? "").trim() } };
  },
};

// ---- Schedule arg parsing (accepts JSON strings OR arrays; falls back to defaults) ----
function parseJsonArray(v: any): any[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

const CADENCE_SET = new Set(["once", "hourly", "daily", "weekly", "monthly", "yearly"]);

/** Build the DB-shaped patch/row from AI-supplied args, falling back to existing
 *  values when a field is omitted. Never returns undefined on required cols. */
function buildScheduleRow(args: any, existing: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (typeof args.title === "string" && args.title.trim()) out.title = args.title.trim().slice(0, 120);
  else if (existing.title !== undefined && !("title" in out)) { /* keep */ }

  if (typeof args.user_request === "string" && args.user_request.trim()) {
    out.user_request = args.user_request.slice(0, 50_000);
  }

  const cadenceRaw = typeof args.cadence === "string" ? args.cadence.toLowerCase() : null;
  if (cadenceRaw && CADENCE_SET.has(cadenceRaw)) out.cadence = cadenceRaw as Cadence;

  if (args.interval_n != null) {
    const n = Math.floor(Number(args.interval_n));
    if (Number.isFinite(n) && n >= 1) out.interval_n = Math.min(n, 365);
  }

  if (args.time_of_day === null) out.time_of_day = null;
  else if (typeof args.time_of_day === "string" && /^\d{1,2}:\d{2}$/.test(args.time_of_day.trim())) {
    out.time_of_day = args.time_of_day.trim();
  }

  if (typeof args.timezone === "string" && args.timezone.trim()) {
    out.timezone = args.timezone.trim().slice(0, 64);
  }

  const wd = parseJsonArray(args.weekdays);
  if (wd) {
    out.weekdays = wd
      .map((n: any) => Math.floor(Number(n)))
      .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6);
  }
  const md = parseJsonArray(args.month_days);
  if (md) {
    out.month_days = md
      .map((n: any) => Math.floor(Number(n)))
      .filter((n: number) => Number.isFinite(n) && n >= 1 && n <= 31);
  }
  const ymd = parseJsonArray(args.year_month_days);
  if (ymd) {
    out.year_month_days = ymd
      .map((e: any) => ({ month: Math.floor(Number(e?.month)), day: Math.floor(Number(e?.day)) }))
      .filter((e: any) => e.month >= 1 && e.month <= 12 && e.day >= 1 && e.day <= 31);
  }

  if (args.starts_at === null) out.starts_at = null;
  else if (typeof args.starts_at === "string" && args.starts_at.trim()) {
    const d = new Date(args.starts_at);
    if (!Number.isNaN(d.getTime())) out.starts_at = d.toISOString();
  }
  if (args.ends_at === null) out.ends_at = null;
  else if (typeof args.ends_at === "string" && args.ends_at.trim()) {
    const d = new Date(args.ends_at);
    if (!Number.isNaN(d.getTime())) out.ends_at = d.toISOString();
  }

  if (args.max_runs === null) out.max_runs = null;
  else if (args.max_runs != null) {
    const n = Math.floor(Number(args.max_runs));
    if (Number.isFinite(n) && n >= 1) out.max_runs = Math.min(n, 10_000);
  }

  const attached = parseJsonArray(args.attached_document_ids);
  if (attached) {
    out.attached_document_ids = attached
      .filter((x: any) => typeof x === "string" && x.length > 0)
      .slice(0, 10);
  }

  // Fill in the fields needed by nextRunAt() from existing when creating.
  const merged = { ...existing, ...out };
  if (!merged.cadence) throw new Error("cadence is required (once|hourly|daily|weekly|monthly|yearly)");
  if (!merged.title) out.title = merged.title ?? "Untitled schedule";
  if (!merged.user_request) throw new Error("user_request is required (what Orby should run each time)");
  if (merged.interval_n == null) out.interval_n = 1;
  if (!merged.timezone) out.timezone = "UTC";
  if (out.weekdays == null && existing.weekdays == null) out.weekdays = [];
  if (out.month_days == null && existing.month_days == null) out.month_days = [];
  if (out.year_month_days == null && existing.year_month_days == null) out.year_month_days = [];
  if (out.attached_document_ids == null && existing.attached_document_ids == null) out.attached_document_ids = [];

  return out;
}

function summarizeRun(steps: any[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.description ?? s.tool}`).join("\n");
}

function buildLovablePrompt(plan: any, failedStep: any, errorMessage: string): string {
  return [
    "A plan in Orby failed during execution. Please investigate.",
    "",
    `User's original request: ${plan.user_request}`,
    "",
    `Failed step ${(plan.current_step ?? 0) + 1} of ${plan.total_steps}: ${failedStep?.description ?? "(no description)"}`,
    `Tool: ${failedStep?.tool}`,
    `Args (after template resolution may have failed): ${JSON.stringify(failedStep?.args, null, 2)}`,
    "",
    `Error message: ${errorMessage}`,
    "",
    "Likely files to investigate:",
    "- supabase/functions/plan-step/index.ts (the tool handler that errored)",
    "- supabase/functions/_shared/tools.ts (the tool catalog)",
    "",
    "Please walk through the handler for the failing tool, propose a fix, and explain why it resolves the error. Show the diff with surrounding context.",
  ].join("\n");
}

const PLAN_TICK_SECRET = Deno.env.get("PLAN_TICK_SECRET") ?? "";

// Hard caps — defense in depth against runaway plans.
const MAX_TICKS = 300; // plenty for 50 media steps
const MAX_NO_PROGRESS = 300; // raised: video gens routinely take 8-15 min of "no row change"
// Per-media wall-clock cap (ms). Videos can take 15+ min; cap at 30.
const MAX_MEDIA_WAIT_MS = 30 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { plan_id, user_id: bodyUserId, internal_secret } = body ?? {};
  if (typeof plan_id !== "string") return json({ error: "plan_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Two callers: (a) user from the app with a bearer token, (b) the server-side
  // plan-tick cron passing the shared secret + the plan's user_id.
  let userId: string;
  let userClient: any;
  const isInternal = !!internal_secret && internal_secret === PLAN_TICK_SECRET;
  if (isInternal) {
    if (typeof bodyUserId !== "string") return json({ error: "user_id required" }, 400);
    userId = bodyUserId;
    // No end-user JWT on internal ticks; tool handlers fall through to `admin`.
    userClient = admin;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    userId = userData.user.id;
  }
  const user = { id: userId };

  // ---- Concurrency guard ----
  // Atomically claim this plan for execution. A 90s ceiling auto-expires
  // zombie claims from edge functions that died mid-step.
  const STALE_CLAIM_CUTOFF = new Date(Date.now() - 90_000).toISOString();
  const { data: claimed } = await admin
    .from("plans")
    .update({ step_claim_at: new Date().toISOString() })
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .or(`step_claim_at.is.null,step_claim_at.lt.${STALE_CLAIM_CUTOFF}`)
    .select("*")
    .maybeSingle();
  if (!claimed) {
    return json({ status: "running", note: "already_running" });
  }
  const plan = claimed;

  const newTickCount = (plan.tick_count ?? 0) + 1;
  const releaseClaim = async (extraUpdates: Record<string, unknown> = {}) => {
    const patch: Record<string, unknown> = {
      step_claim_at: null,
      tick_count: newTickCount,
      ...extraUpdates,
    };
    // Default: reset no-progress counter on every advance. The awaiting_media
    // "still generating" branch overrides this to bump it instead.
    if (!("consecutive_no_progress" in patch)) patch.consecutive_no_progress = 0;
    // Never let a post-step write resurrect a plan the user cancelled mid-step.
    await admin.from("plans").update(patch).eq("id", plan_id).neq("status", "cancelled");
  };

  // ---- Guardrails ----
  const reportTerminal = async (text: string) => {
    if (!plan.thread_id || !text) return;
    try {
      await admin.from("chat_messages").insert({
        user_id: user.id,
        thread_id: plan.thread_id,
        role: "assistant",
        content: text,
        kind: "text",
        plan_id: plan.id,
      });
      await admin.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", plan.thread_id);
    } catch (_e) { /* best-effort */ }
  };
  const failWithReason = async (reason: string) => {
    await admin
      .from("plans")
      .update({
        step_claim_at: null,
        status: "failed",
        error_message: reason,
        completed_at: new Date().toISOString(),
      })
      .eq("id", plan_id);
    await reportTerminal(`I hit a problem: ${reason}`);
    return json({ status: "failed", error: reason });
  };
  if (plan.watchdog_at && new Date(plan.watchdog_at).getTime() < Date.now()) {
    return await failWithReason("watchdog_timeout: plan exceeded its wall-clock deadline");
  }
  if ((plan.tick_count ?? 0) >= MAX_TICKS) {
    return await failWithReason(`tick_limit_exceeded: plan ran for ${MAX_TICKS} server ticks without finishing`);
  }
  if ((plan.consecutive_no_progress ?? 0) >= MAX_NO_PROGRESS) {
    return await failWithReason("stalled: media generation made no progress for too long");
  }

  if (plan.status === "cancelled") {
    await releaseClaim();
    return json({ status: "cancelled" });
  }

  if (plan.status === "approved") {
    plan.status = "running";
    // Persisted on first downstream update; no separate write needed.
  }
  if (plan.status === "awaiting_user") {
    // Paused waiting for a chat reply. Do nothing; releaseClaim() would bump
    // tick_count, but plan-tick's status filter also excludes awaiting_user so
    // this branch is essentially unreachable from cron — it only triggers if
    // something invokes plan-step directly. Reset the claim and return.
    await admin.from("plans").update({ step_claim_at: null }).eq("id", plan.id);
    return json({ status: "awaiting_user" });
  }
  if (plan.status !== "running" && plan.status !== "awaiting_media") {
    await releaseClaim();
    return json({ status: plan.status });
  }


  const steps: any[] = Array.isArray(plan.steps) ? plan.steps : [];
  const idx: number = plan.current_step ?? 0;

  // ---- Resume path: a previous step kicked off a media generation; check on it. ----
  if (plan.status === "awaiting_media") {
    const step = steps[idx];
    const mediaId: string | undefined = step?.pending_media_id;
    if (!mediaId) {
      // Defensive: drop back to running so we re-evaluate.
      await releaseClaim({ status: "running" });
      return json({ status: "running" });
    }

    // Wall-clock cap per media item — videos can legitimately take 15+ min,
    // but if nothing finishes after MAX_MEDIA_WAIT_MS we should bail out.
    const mediaStartedAt: string | undefined = step?.media_started_at;
    if (mediaStartedAt && Date.now() - new Date(mediaStartedAt).getTime() > MAX_MEDIA_WAIT_MS) {
      step.status = "failed";
      step.error = `media_timeout: still generating after ${Math.round(MAX_MEDIA_WAIT_MS / 60000)} min`;
      const lovablePrompt = buildLovablePrompt(plan, step, step.error);
      await releaseClaim({
        steps, status: "failed", error_message: step.error,
        error_lovable_prompt: lovablePrompt, completed_at: new Date().toISOString(),
      });
      return json({ status: "failed", error: step.error });
    }

    // First, drain fal's queue for this row if it's a queued (video) job.
    // Without this, the media_assets row only changes when the browser hook
    // happens to be running — closing the tab strands the plan.
    const { data: preCheck } = await admin
      .from("media_assets")
      .select("id, status, fal_status_url")
      .eq("id", mediaId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (preCheck?.status === "generating" && preCheck.fal_status_url) {
      try {
        await invokeEdgeFunction(userClient, "poll-video-job", { row_id: mediaId }, { internal: isInternal, user_id: user.id });
      } catch (_e) {
        // Poll failures are non-fatal — we'll retry next tick.
      }
    }

    const { data: media } = await admin
      .from("media_assets")
      .select("id, status, url, title, error_message")
      .eq("id", mediaId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!media) {
      step.status = "failed";
      step.error = `Pending media ${mediaId} disappeared`;
      const lovablePrompt = buildLovablePrompt(plan, step, step.error);
      await releaseClaim({
        steps, status: "failed", error_message: step.error,
        error_lovable_prompt: lovablePrompt, completed_at: new Date().toISOString(),
      });
      return json({ status: "failed", error: step.error });
    }
    if (media.status === "generating") {
      // Still rendering at the vendor. Bump the no-progress counter as a
      // secondary safety net; the wall-clock cap above is the primary one.
      await releaseClaim({ consecutive_no_progress: (plan.consecutive_no_progress ?? 0) + 1 });
      return json({ status: "awaiting_media", media_id: mediaId });
    }
    if (media.status === "failed") {
      step.status = "failed";
      step.error = media.error_message || "Media generation failed";
      const lovablePrompt = buildLovablePrompt(plan, step, step.error);
      await releaseClaim({
        steps, status: "failed", error_message: step.error,
        error_lovable_prompt: lovablePrompt, completed_at: new Date().toISOString(),
      });
      return json({ status: "failed", error: step.error });
    }
    // completed
    step.status = "completed";
    step.result = { id: media.id, title: media.title, url: media.url };
    step.error = null;
    step.pending_media_id = null;
    const nextIdx = idx + 1;
    const updates: any = { steps, current_step: nextIdx, status: "running" };
    if (nextIdx >= steps.length) {
      updates.status = "completed";
      updates.result_summary = summarizeRun(steps);
      updates.completed_at = new Date().toISOString();
    }
    await releaseClaim(updates);
    if (updates.status === "completed") {
      await reportTerminal(`✅ All done. ${updates.result_summary ?? ""}`.trim());
    }
    return json({ status: updates.status, advanced_to: nextIdx });
  }

  if (idx >= steps.length) {
    await releaseClaim({ status: "completed", result_summary: summarizeRun(steps), completed_at: new Date().toISOString() });
    return json({ status: "completed" });
  }

  const step = steps[idx];
  step.status = "running";
  // Note: claim is already held; this is just persisting the running flag on the step.
  await admin.from("plans").update({ steps, status: "running" }).eq("id", plan.id).neq("status", "cancelled");

  try {
    const resolvedArgs = resolveTemplates(step.args ?? {}, steps);
    const handler = TOOL_HANDLERS[step.tool];
    if (!handler || step.tool.startsWith("_")) throw new Error(`Unknown tool: ${step.tool}`);
    void TOOL_CATALOG;
    const result = await handler(resolvedArgs, {
      user_id: user.id,
      admin,
      supabase: userClient,
      internal: isInternal,
      baseIndex: idx + 1,
      plan_id: plan.id,
      thread_id: plan.thread_id ?? null,
    });

    // ask_user: pause the plan and record the question. When the user replies
    // in chat, chat.functions writes result.answer and flips status → running.
    if (result && typeof result === "object" && "__ask_user" in result) {
      const askInfo = (result as any).__ask_user ?? {};
      const question = String(askInfo.question ?? "").trim();
      const ctxText = String(askInfo.context ?? "").trim();
      step.status = "awaiting_user";
      step.result = { question, context: ctxText };
      step.error = null;
      // Post the question to the chat thread so the user sees it.
      if (plan.thread_id) {
        const bubble = ctxText ? `${question}\n\n${ctxText}` : question;
        try {
          await admin.from("chat_messages").insert({
            user_id: user.id,
            thread_id: plan.thread_id,
            role: "assistant",
            content: bubble,
            kind: "text",
            plan_id: plan.id,
          });
          await admin.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", plan.thread_id);
        } catch (_e) { /* best-effort */ }
      }
      await releaseClaim({
        steps,
        status: "awaiting_user",
        awaiting_since: new Date().toISOString(),
        awaiting_count: (plan.awaiting_count ?? 0) + 1,
      });
      return json({ status: "awaiting_user" });
    }

    // Runtime expansion: splice the AI-generated sub-steps in right after this
    // step, then continue. current_step advances to the first new step.
    if (result && typeof result === "object" && "__expand_steps" in result) {
      const newSteps: any[] = Array.isArray((result as any).__expand_steps) ? (result as any).__expand_steps : [];
      step.status = "completed";
      step.result = { expanded: newSteps.length };
      step.error = null;
      steps.splice(idx + 1, 0, ...newSteps);
      const nextIdx = idx + 1;
      const updates: any = { steps, current_step: nextIdx, total_steps: steps.length };
      if (nextIdx >= steps.length) {
        updates.status = "completed";
        updates.result_summary = summarizeRun(steps);
        updates.completed_at = new Date().toISOString();
      }
      await releaseClaim(updates);
      return json({ status: updates.status ?? "running", advanced_to: nextIdx, expanded: newSteps.length });
    }

    // Async media generation: pause the plan until the media asset finishes.
    if (result && typeof result === "object" && "__pending_media" in result) {
      step.status = "awaiting_media";
      step.pending_media_id = result.__pending_media;
      step.media_started_at = new Date().toISOString();
      await releaseClaim({ steps, status: "awaiting_media" });
      return json({ status: "awaiting_media", media_id: result.__pending_media });
    }

    step.status = "completed";
    step.result = result;
    step.error = null;

    const nextIdx = idx + 1;
    const updates: any = { steps, current_step: nextIdx };
    if (nextIdx >= steps.length) {
      updates.status = "completed";
      updates.result_summary = summarizeRun(steps);
      updates.completed_at = new Date().toISOString();
    }
    await releaseClaim(updates);
    if (updates.status === "completed") {
      await reportTerminal(`✅ All done. ${updates.result_summary ?? ""}`.trim());
    }
    return json({ status: updates.status ?? "running", advanced_to: nextIdx });
  } catch (err: any) {
    step.status = "failed";
    step.error = String(err?.message ?? err);
    const lovablePrompt = buildLovablePrompt(plan, step, step.error);
    await releaseClaim({
      steps,
      status: "failed",
      error_message: step.error,
      error_lovable_prompt: lovablePrompt,
      completed_at: new Date().toISOString(),
    });
    await reportTerminal(`⚠️ Step ${idx + 1} failed: ${step.error}`);
    return json({ status: "failed", error: step.error });
  }
});
