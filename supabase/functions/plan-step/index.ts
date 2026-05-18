import { createClient } from "npm:@supabase/supabase-js@^2.45.0";
import { TOOL_CATALOG } from "../_shared/tools.ts";

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

function resolveTemplates(value: any, steps: any[]): any {
  if (typeof value === "string") {
    return value.replace(/\{\{step_(\d+)\.([^}]+)\}\}/g, (_, idxStr, path) => {
      const idx = parseInt(idxStr, 10);
      const src = steps[idx]?.result;
      if (src == null) throw new Error(`Template refers to step_${idx} which has no result`);
      return String(resolvePath(src, path));
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

function resolvePath(obj: any, path: string): any {
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
  let cur: any = obj;
  for (const t of tokens) {
    if (cur == null) throw new Error(`Path ${path} resolves to null mid-way`);
    cur = cur[t as any];
  }
  if (cur == null) throw new Error(`Path ${path} resolved to null`);
  return cur;
}

type ToolCtx = { user_id: string; admin: any };

const TOOL_HANDLERS: Record<string, (args: any, ctx: ToolCtx) => Promise<any>> = {
  async find_document_by_title(args, { user_id, admin }) {
    const { data } = await admin
      .from("documents")
      .select("id, title")
      .eq("user_id", user_id)
      .ilike("title", `%${args.query}%`)
      .order("updated_at", { ascending: false })
      .limit(5);
    return data ?? [];
  },
  async find_sentence_by_content(args, { user_id, admin }) {
    let q = admin
      .from("sentences")
      .select("id, document_id, content, order_index")
      .eq("user_id", user_id)
      .ilike("content", `%${args.query}%`)
      .order("created_at", { ascending: false })
      .limit(5);
    if (args.document_id) q = q.eq("document_id", args.document_id);
    const { data } = await q;
    return data ?? [];
  },
  async find_media_by_title(args, { user_id, admin }) {
    const { data } = await admin
      .from("media_assets")
      .select("id, title, kind")
      .eq("user_id", user_id)
      .ilike("title", `%${args.query}%`)
      .order("created_at", { ascending: false })
      .limit(5);
    return data ?? [];
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
  async add_sentence(args, { user_id, admin }) {
    const pos = args.position ?? "bottom";
    let insertAt = 0;
    if (pos === "top") {
      insertAt = 0;
    } else if (pos === "after_current") {
      const { data: doc } = await admin
        .from("documents")
        .select("current_sentence_index, user_id")
        .eq("id", args.document_id)
        .eq("user_id", user_id)
        .single();
      insertAt = (doc?.current_sentence_index ?? -1) + 1;
    } else {
      const { count } = await admin
        .from("sentences")
        .select("id", { count: "exact", head: true })
        .eq("document_id", args.document_id);
      insertAt = count ?? 0;
    }
    // Verify ownership of the doc before inserting via service role
    const { data: docRow } = await admin
      .from("documents")
      .select("id")
      .eq("id", args.document_id)
      .eq("user_id", user_id)
      .single();
    if (!docRow) throw new Error("Document not found");
    // Direct insert (service role bypasses the auth.uid() check inside the RPC)
    // Shift existing rows then insert.
    const { data: existing } = await admin
      .from("sentences")
      .select("id, order_index")
      .eq("document_id", args.document_id)
      .gte("order_index", insertAt)
      .order("order_index", { ascending: false });
    if (existing && existing.length > 0) {
      // Park in negative range first, then restore
      for (const row of existing) {
        await admin.from("sentences").update({ order_index: -(row.order_index + 1000) }).eq("id", row.id);
      }
      for (const row of existing) {
        await admin.from("sentences").update({ order_index: row.order_index + 1 }).eq("id", row.id);
      }
    }
    const { data: ins, error: insErr } = await admin
      .from("sentences")
      .insert({ user_id, document_id: args.document_id, content: args.content, order_index: insertAt })
      .select("id, content, order_index")
      .single();
    if (insErr) throw new Error(insErr.message);
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
  async move_sentence(args, { user_id, admin }) {
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
      .single();
    if (!s) throw new Error("Sentence not found");
    const inserted = await TOOL_HANDLERS.add_sentence(
      { document_id: args.target_document_id, content: s.content, position: pos === "top" ? "top" : (pos === "after_current" ? "after_current" : "bottom") },
      { user_id, admin },
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
};

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

  if (plan.status === "approved") {
    await admin.from("plans").update({ status: "running" }).eq("id", plan.id).eq("status", "approved");
    plan.status = "running";
  }
  if (plan.status !== "running") {
    return json({ status: plan.status });
  }

  const steps: any[] = Array.isArray(plan.steps) ? plan.steps : [];
  const idx: number = plan.current_step ?? 0;
  if (idx >= steps.length) {
    await admin
      .from("plans")
      .update({ status: "completed", result_summary: summarizeRun(steps), completed_at: new Date().toISOString() })
      .eq("id", plan.id);
    return json({ status: "completed" });
  }

  const step = steps[idx];
  step.status = "running";
  await admin.from("plans").update({ steps }).eq("id", plan.id);

  try {
    const resolvedArgs = resolveTemplates(step.args ?? {}, steps);
    const handler = TOOL_HANDLERS[step.tool];
    if (!handler) throw new Error(`Unknown tool: ${step.tool}`);
    void TOOL_CATALOG; // referenced to keep import; could validate further if needed
    const result = await handler(resolvedArgs, { user_id: user.id, admin });

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
    await admin.from("plans").update(updates).eq("id", plan.id);
    return json({ status: updates.status ?? "running", advanced_to: nextIdx });
  } catch (err: any) {
    step.status = "failed";
    step.error = String(err?.message ?? err);
    const lovablePrompt = buildLovablePrompt(plan, step, step.error);
    await admin
      .from("plans")
      .update({
        steps,
        status: "failed",
        error_message: step.error,
        error_lovable_prompt: lovablePrompt,
        completed_at: new Date().toISOString(),
      })
      .eq("id", plan.id);
    return json({ status: "failed", error: step.error });
  }
});
