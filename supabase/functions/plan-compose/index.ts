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
- Match user intent loosely. "Find the sentence about pasta" means use find_sentence_by_content with query "pasta". Do not require the user to give you exact wording.
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
    const raw = await callPlannerLLM(systemPrompt, plan.user_request);
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
