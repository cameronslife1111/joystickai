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
- A WORKSPACE SNAPSHOT (after this prompt) lists the user's actual documents and media with their real ids, and inlines the full text of any document the user named. ALWAYS prefer ids and content from the snapshot over calling find_document_by_title / find_media_by_title / find_sentence_by_content / read_document.
- To USE the text inside a document in a later step (e.g. "use the prompt in the X doc as the image prompt"), inline the literal text from the snapshot directly into that step's args. Only call read_document when the doc was not inlined and you need its content at runtime. When piping a document into a media tool's prompt and you must use read_document, reference {{step_N.result.text}} — NEVER {{step_N.result.sentences}} (that's an array of objects, not a string, and will fail validation).
- find_sentence_by_content is ONLY for locating a specific sentence ROW you intend to mutate (edit/move/mark/link). Never use it to fetch content for a later step's args, and never require the user to remember exact wording.
- Match user intent loosely. Do not require exact wording.
- When a step needs the result of an earlier step, reference it with template syntax: {{step_<index>.result.<path>}}. Examples:
  - {{step_0.result[0].id}}  -> the id of the first item returned by step 0
  - {{step_1.result.id}}     -> the id field of step 1's result (when result is a single object)
  - {{step_2.result.text}}   -> the text field of step 2's result
- find_* tools return ARRAYS of matches (best match first). Subsequent steps almost always want {{step_N.result[0].id}}.
- create_document and add_sentence return objects with at least an "id" field.
- Plan as few steps as possible. Combine where reasonable.

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const user = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { plan_id } = body ?? {};
  if (typeof plan_id !== "string") return json({ error: "plan_id required" }, 400);

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
    const userContextLines: string[] = [];
    const docId = (plan as any).origin_document_id as string | null | undefined;
    const sentenceIdx = (plan as any).origin_sentence_index as number | null | undefined;
    if (docId) {
      const { data: doc } = await admin
        .from("documents").select("id, title")
        .eq("id", docId).eq("user_id", user.id).maybeSingle();
      if (doc) {
        userContextLines.push(`active_document_id: ${doc.id}`);
        userContextLines.push(`active_document_title: ${JSON.stringify(doc.title ?? "")}`);
      }
      if (typeof sentenceIdx === "number" && sentenceIdx >= 0) {
        const { data: sents } = await admin
          .from("sentences").select("id, content, order_index")
          .eq("document_id", docId).order("order_index", { ascending: true })
          .range(sentenceIdx, sentenceIdx);
        const sent = sents?.[0];
        if (sent) {
          userContextLines.push(`current_sentence_id: ${sent.id}`);
          userContextLines.push(`current_sentence_text: ${JSON.stringify(sent.content ?? "")}`);
          userContextLines.push(`current_sentence_position: ${sent.order_index}`);
        }
      }
    }

    // Full list of documents (id + title)
    const { data: allDocs } = await admin
      .from("documents").select("id, title, updated_at")
      .eq("user_id", user.id).order("updated_at", { ascending: false }).limit(200);
    const docList = allDocs ?? [];

    // Pick docs whose title appears (case-insensitive) as a substring of the
    // user's request — those get their full sentences inlined.
    const reqLower = (plan.user_request ?? "").toLowerCase();
    const referencedDocs = docList.filter((d: any) => {
      const t = String(d.title ?? "").trim().toLowerCase();
      return t.length >= 2 && reqLower.includes(t);
    });

    // Cap to first ~6 referenced docs to bound prompt size.
    const docsToInline = referencedDocs.slice(0, 6);
    const inlinedDocSections: string[] = [];
    for (const d of docsToInline) {
      const { data: sents } = await admin
        .from("sentences").select("id, order_index, content")
        .eq("document_id", d.id).eq("user_id", user.id)
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
      inlinedDocSections.push(
        `  document_id: ${d.id}\n  title: ${JSON.stringify(d.title ?? "")}\n  sentences (${rows.length}${truncated ? ", truncated" : ""}):\n${lines.join("\n")}`,
      );
    }

    // Media assets
    const { data: allMedia } = await admin
      .from("media_assets").select("id, title, kind, generation_params, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(200);
    const mediaList = (allMedia ?? []).map((m: any) => ({
      id: m.id, title: m.title, kind: m.kind,
      source_text: m?.generation_params?.user_text ?? null,
    }));

    let userContext = "";
    if (userContextLines.length) userContext += `\nORIGIN CONTEXT:\n  ${userContextLines.join("\n  ")}`;
    if (docList.length) {
      userContext += `\n\nALL DOCUMENTS (id — title):\n${docList.map((d: any) => `  ${d.id} — ${JSON.stringify(d.title ?? "")}`).join("\n")}`;
    }
    if (inlinedDocSections.length) {
      userContext += `\n\nREFERENCED DOCUMENTS (full contents inlined — use these ids and content directly, do NOT call find_document_by_title or find_sentence_by_content for them):\n${inlinedDocSections.join("\n\n")}`;
    }
    if (mediaList.length) {
      userContext += `\n\nALL MEDIA (id — kind — title — source_text):\n${mediaList.map((m: any) => `  ${m.id} — ${m.kind} — ${JSON.stringify(m.title ?? "")}${m.source_text ? ` — src=${JSON.stringify(String(m.source_text).slice(0, 200))}` : ""}`).join("\n")}`;
    }

    const effectiveSystemPrompt = userContext
      ? `${systemPrompt}\n\nWORKSPACE SNAPSHOT (the user's actual data right now — resolve references like "this doc", "the Cameron inbox", "the reference image" using these values; if an id is present here, use it directly and do NOT call a find_* tool for it; if a referenced document's sentences are inlined here, you may inline their text directly into later step args instead of calling read_document):${userContext}`
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
