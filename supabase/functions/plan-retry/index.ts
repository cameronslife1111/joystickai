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
  throw new Error(`Unknown PLANNER_PROVIDER: ${PLANNER_PROVIDER}`);
}

const systemPrompt = `You are Orby's plan REPAIR planner. A multi-step plan failed partway through. Your job is to repair the FAILED step (and any steps after it) so the plan can resume and complete. You use ONLY the tools listed below.

You have these tools (no others exist):

${toolCatalogForPrompt()}

CRITICAL REPAIR RULES:
- The plan already has COMPLETED steps at indices 0..K-1. These are LOCKED. Do NOT re-emit them. Their results already exist and can be referenced by later steps using {{step_<index>.result.<path>}} with their ORIGINAL absolute indices.
- You must output ONLY the replacement steps, starting at index K (the failed step) through the end of the plan. The first replacement step you return corresponds to absolute index K, the next to K+1, and so on.
- Study the FAILED STEP, its arguments, and the ERROR MESSAGE below. Diagnose what went wrong and fix it. Common fixes: trimming inputs that exceed a provider limit, correcting an argument, splitting one step into several, or re-ordering.
- The USER NOTE (if present) is an ABSOLUTE CONSTRAINT. Obey it exactly when repairing the steps.
- When a replacement step needs the output of a LOCKED step, reference it with its original absolute index, e.g. {{step_3.result[0].id}}. When it needs the output of an earlier REPLACEMENT step, use that step's new absolute index.
- Keep the repair minimal and faithful to the user's original intent. Do not add unrelated work.
- You CANNOT delete user data. There is no delete tool.
- Prefer ids and content from the WORKSPACE SNAPSHOT below over calling find_* tools.

Return your output as JSON with this exact shape:
{
  "summary": "A one-or-two-sentence plain-language summary of how you repaired the plan.",
  "steps": [
    {
      "tool": "<tool_name from the catalog>",
      "args": { ...arguments matching the tool's schema... },
      "description": "A short plain-language sentence describing this step."
    }
  ]
}

If the plan cannot be repaired, respond with:
{
  "summary": "I can't repair this plan as described.",
  "steps": [],
  "explanation": "<one short sentence explaining why>"
}

Plain text only. No markdown, no code fences. Return the JSON object directly.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { plan_id, note, user_id: bodyUserId, internal_secret } = body ?? {};
  if (typeof plan_id !== "string") return json({ error: "plan_id required" }, 400);
  const userNote = typeof note === "string" ? note.trim().slice(0, 4000) : "";

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
  if (plan.status !== "failed") return json({ error: `plan is ${plan.status}, not failed` }, 409);

  const allSteps: any[] = Array.isArray(plan.steps) ? plan.steps : [];
  const K = Math.max(0, Math.min(plan.current_step ?? 0, allSteps.length));
  // Rewind a couple of steps before the failure so the plan re-runs them for
  // consistency, then continues through the failed step and everything after.
  const BACKUP_STEPS = 2;
  const startIndex = Math.max(0, K - BACKUP_STEPS);
  const locked = allSteps.slice(0, startIndex);
  const rewound = allSteps.slice(startIndex, K); // completed steps we intentionally re-run
  const failedStep = allSteps[K] ?? null;

  // Mark the plan as "retrying" immediately so the user sees progress and can
  // leave the screen. plan-tick ignores this status, so the stale failed step
  // is never executed while we compose the repair below.
  await admin
    .from("plans")
    .update({
      status: "retrying",
      retry_note: userNote || null,
      error_message: null,
      error_lovable_prompt: null,
      step_claim_at: null,
    })
    .eq("id", plan_id)
    .eq("user_id", user.id);

  const runRepair = async () => {
    // ---- Build a WORKSPACE SNAPSHOT (same approach as plan-compose) so the
    //      repair planner can resolve doc/media references naturally. ----
    const { data: allDocs } = await admin
      .from("documents").select("id, title, updated_at")
      .eq("user_id", user.id).order("updated_at", { ascending: false }).limit(2000);
    const docList = allDocs ?? [];

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

    const scoredDocs = docList.map((d: any) => ({ d, score: scoreText(String(d.title ?? "")) }));
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
    const inlineIds = [...forcedDocIds, ...scoreInlineIds];
    const docById = new Map(docList.map((d: any) => [d.id, d]));

    const inlineDoc = async (id: string): Promise<string | null> => {
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

    const attachmentsHeader = forcedDocIds.length
      ? forcedDocIds.map((id) => {
          const d: any = docById.get(id);
          const title = d?.title ?? "(attached document)";
          return `  ${id} — ${JSON.stringify(title)}`;
        }).join("\n")
      : "";

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
      userContext += `\n\nATTACHED DOCUMENTS (the user explicitly attached these to the original request — their full text is inlined under REFERENCED DOCUMENTS below):\n${attachmentsHeader}`;
    }
    if (docList.length) {
      userContext += `\n\nALL DOCUMENTS (id — title):\n${docList.map((d: any) => `  ${d.id} — ${JSON.stringify(d.title ?? "")}`).join("\n")}`;
    }
    if (inlinedDocSections.length) {
      userContext += `\n\nREFERENCED DOCUMENTS (full contents inlined — use these ids and content directly):\n${inlinedDocSections.join("\n\n")}`;
    }
    if (mediaList.length) {
      userContext += `\n\nALL MEDIA (id — kind — title — source_text, ranked by relevance):\n${mediaList.map((m: any) => `  ${m.id} — ${m.kind} — ${JSON.stringify(m.title ?? "")}${m.source_text ? ` — src=${JSON.stringify(String(m.source_text).slice(0, 200))}` : ""}`).join("\n")}`;
    }

    // ---- Compact listing of the LOCKED completed steps so the planner can
    //      wire {{step_N.result...}} references to real prior outputs. ----
    const lockedListing = locked.map((s: any, i: number) => {
      let preview = "";
      try {
        preview = JSON.stringify(s.result ?? null);
      } catch {
        preview = "<unserializable>";
      }
      if (preview && preview.length > 300) preview = preview.slice(0, 300) + "…";
      return `  [index ${i}] tool=${s.tool} — ${String(s.description ?? "").slice(0, 160)}\n    result: ${preview}`;
    }).join("\n");

    // ---- Steps we are intentionally REWINDING (they completed before, but we
    //      back up a couple of steps and re-run them for consistency). ----
    const rewoundListing = rewound.map((s: any, i: number) =>
      `  [absolute index ${startIndex + i}] tool=${s.tool} — ${String(s.description ?? "").slice(0, 160)}`,
    ).join("\n");

    const failedDescription = failedStep
      ? `FAILED STEP (absolute index ${K}):\n  tool: ${failedStep.tool}\n  description: ${String(failedStep.description ?? "")}\n  args: ${JSON.stringify(failedStep.args ?? {}, null, 2)}`
      : `The plan failed without a clearly identified failing step. Repair from index ${startIndex} onward.`;

    const remainingAfterFailed = allSteps.slice(K + 1).map((s: any, i: number) =>
      `  [original index ${K + 1 + i}] tool=${s.tool} — ${String(s.description ?? "").slice(0, 160)}`,
    ).join("\n");

    const repairUserPrompt = [
      `ORIGINAL USER REQUEST:\n${plan.user_request}`,
      "",
      `COMPLETED (LOCKED) STEPS — indices 0..${startIndex - 1} (DO NOT re-emit these; reference their results by these indices):`,
      lockedListing || "  (none)",
      "",
      `REWOUND STEPS — indices ${startIndex}..${K - 1} (these completed successfully before, but we are intentionally backing up to re-run them so the plan restarts a couple of steps earlier for consistency — RE-EMIT/repair these as your first replacement steps):`,
      rewoundListing || "  (none)",
      "",
      failedDescription,
      "",
      `ERROR MESSAGE:\n${plan.error_message ?? "(none recorded)"}`,
      "",
      "REMAINING STEPS THAT NEVER RAN (originally planned after the failed step — re-emit/repair as needed; they will be renumbered to follow your replacement steps):",
      remainingAfterFailed || "  (none)",
      "",
      userNote
        ? `USER NOTE (ABSOLUTE CONSTRAINT — obey exactly):\n${userNote}`
        : "USER NOTE: (none provided)",
      "",
      `Produce replacement steps starting at absolute index ${startIndex} (the first REWOUND step). Re-emit the rewound steps, the failed step (repaired), and all remaining steps.`,
    ].join("\n");

    const effectiveSystemPrompt = userContext
      ? `${systemPrompt}\n\nWORKSPACE SNAPSHOT (the user's actual data right now — resolve references by fuzzy-matching titles/content/media here; if an id is present, use it directly):${userContext}`
      : systemPrompt;

    const raw = await callPlannerLLM(effectiveSystemPrompt, repairUserPrompt);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Repair planner returned non-JSON output");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("Repair planner returned malformed output");
    const newTail = Array.isArray(parsed.steps) ? parsed.steps : [];
    if (newTail.length === 0) {
      const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "no repair steps produced";
      throw new Error(`Could not repair plan: ${explanation}`);
    }

    const toolNames = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const [i, s] of newTail.entries()) {
      if (!s || typeof s !== "object") throw new Error(`Repair step ${i + 1} is malformed`);
      if (typeof s.tool !== "string" || !toolNames.has(s.tool)) {
        throw new Error(`Repair step ${i + 1} uses unknown tool: ${s.tool}`);
      }
      if (!s.args || typeof s.args !== "object") s.args = {};
      if (typeof s.description !== "string" || !s.description.trim()) {
        s.description = `Run ${s.tool}`;
      }
      s.status = "pending";
      s.result = null;
      s.error = null;
    }

    const mergedSteps = [...locked, ...newTail];
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";

    await admin
      .from("plans")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        steps: mergedSteps,
        total_steps: mergedSteps.length,
        current_step: startIndex,
        step_claim_at: null,
        consecutive_no_progress: 0,
        error_message: null,
        error_lovable_prompt: null,
        completed_at: null,
        retry_count: (plan.retry_count ?? 0) + 1,
        retry_note: userNote || null,
        plan_summary: summary
          ? `${plan.plan_summary ? plan.plan_summary + "\n\n" : ""}Retry ${(plan.retry_count ?? 0) + 1}: ${summary}`
          : plan.plan_summary,
      })
      .eq("id", plan_id)
      .eq("user_id", user.id);
  };

  // Run the repair in the background so the user can leave the screen. The plan
  // shows as "retrying" until the repair completes and flips it to "approved".
  const repairWithGuard = async () => {
    try {
      await runRepair();
    } catch (err: any) {
      // Leave the plan failed but refresh the error so the user can see why the retry didn't work.
      await admin
        .from("plans")
        .update({
          status: "failed",
          error_message: `Retry failed: ${String(err?.message ?? err ?? "unknown error")}`,
        })
        .eq("id", plan_id)
        .eq("user_id", user.id);
    }
  };

  // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(repairWithGuard());
  } else {
    // Fallback (local/dev): fire-and-forget without awaiting.
    repairWithGuard();
  }

  return json({ ok: true, background: true, resumed_from_step: startIndex + 1 });
});
