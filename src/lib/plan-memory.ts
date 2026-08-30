/**
 * Plan memory — shared distillation of the plans that already ran inside a
 * chat thread, so the chat model can keep working agentically after a plan
 * finishes ("you created doc X, here's what's in it, now do Y with it").
 *
 * Deliberately compact + hard-capped: only ids, titles, outcomes and short
 * summaries cross the boundary — never another plan's step instructions.
 */

const MAX_PLANS = 6;
const MAX_SUMMARY_CHARS = 600;
const MAX_DOC_CHARS = 6000;
const INLINE_DOC_COUNT = 2;

export type PlanArtifacts = {
  documentIds: string[];
  mediaIds: string[];
  scheduleIds: string[];
};

/** Pull every doc/media/schedule id a plan's steps touched (args + results). */
export function extractArtifacts(steps: unknown): PlanArtifacts {
  const documentIds = new Set<string>();
  const mediaIds = new Set<string>();
  const scheduleIds = new Set<string>();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const visit = (node: any, tool: string, depth = 0) => {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, tool, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && UUID.test(value)) {
        const k = key.toLowerCase();
        if (k.includes("document_id")) documentIds.add(value);
        else if (k.includes("media_id") || k.includes("image_id") || k.includes("video_id")) mediaIds.add(value);
        else if (k.includes("schedule_id")) scheduleIds.add(value);
        else if (k === "id") {
          if (tool.includes("document") || tool.includes("sentence")) documentIds.add(value);
          else if (tool.includes("image") || tool.includes("video") || tool.includes("media")) mediaIds.add(value);
          else if (tool.includes("schedule")) scheduleIds.add(value);
        }
      } else if (value && typeof value === "object") {
        visit(value, tool, depth + 1);
      }
    }
  };

  const list: any[] = Array.isArray(steps) ? steps : [];
  for (const s of list) {
    const tool = String(s?.tool ?? "").toLowerCase();
    visit(s?.args, tool);
    visit(s?.result, tool);
  }
  return {
    documentIds: [...documentIds],
    mediaIds: [...mediaIds],
    scheduleIds: [...scheduleIds],
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Read a full document's text (paginated — the Data API caps at ~1000 rows). */
async function readDocumentText(supabase: any, docId: string): Promise<string> {
  const PAGE = 1000;
  const out: string[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: rows, error } = await supabase
      .from("sentences")
      .select("content")
      .eq("document_id", docId)
      .order("order_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = rows ?? [];
    for (const r of batch) out.push(r.content);
    if (batch.length < PAGE) break;
    from += PAGE;
    if (out.join(" ").length > MAX_DOC_CHARS) break;
  }
  return clip(out.join(" ").trim(), MAX_DOC_CHARS);
}

export type PlanMemory = {
  /** Full block for the system prompt. Empty string when there's nothing. */
  block: string;
  /** One-line digest for the intent router. */
  digest: string;
  /** Document ids touched by remembered plans, newest first. */
  documentIds: string[];
};

/**
 * Build the thread's plan memory. `inlineDocs` pulls the current text of the
 * most recently touched documents so Orby can answer about them without the
 * user re-attaching anything.
 */
export async function buildPlanMemory(
  supabase: any,
  threadId: string | undefined,
  opts: { inlineDocs?: boolean; excludeDocIds?: string[] } = {},
): Promise<PlanMemory> {
  const empty: PlanMemory = { block: "", digest: "", documentIds: [] };
  if (!threadId) return empty;

  const { data: plans } = await supabase
    .from("plans")
    .select("id, user_request, plan_summary, result_summary, error_message, status, steps, completed_at, created_at")
    .eq("thread_id", threadId)
    .in("status", ["completed", "failed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(MAX_PLANS);

  const rows: any[] = plans ?? [];
  if (!rows.length) return empty;

  // Newest-first artifacts, de-duped across plans.
  const orderedDocIds: string[] = [];
  const orderedMediaIds: string[] = [];
  const perPlan = rows.map((p) => {
    const a = extractArtifacts(p.steps);
    for (const id of a.documentIds) if (!orderedDocIds.includes(id)) orderedDocIds.push(id);
    for (const id of a.mediaIds) if (!orderedMediaIds.includes(id)) orderedMediaIds.push(id);
    return { plan: p, artifacts: a };
  });

  // Resolve titles.
  const docTitles = new Map<string, string>();
  if (orderedDocIds.length) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title")
      .in("id", orderedDocIds.slice(0, 40));
    for (const d of docs ?? []) docTitles.set(d.id, d.title ?? "Untitled");
  }
  const mediaTitles = new Map<string, string>();
  if (orderedMediaIds.length) {
    const { data: media } = await supabase
      .from("media_assets")
      .select("id, title, kind, generation_params")
      .in("id", orderedMediaIds.slice(0, 40));
    for (const m of media ?? []) {
      // Carry the prompt that made the asset, so a follow-up like "make the
      // sky more orange" can be planned as an edit of that exact item.
      const prompt = (m as any)?.generation_params?.user_text ?? (m as any)?.generation_params?.prompt ?? null;
      mediaTitles.set(
        m.id,
        `${m.title ?? "Untitled"}${m.kind ? ` (${m.kind})` : ""}${prompt ? ` — made from: ${clip(String(prompt), 200)}` : ""}`,
      );
    }
  }

  const planBlocks = perPlan.map(({ plan, artifacts }, i) => {
    const when = plan.completed_at ?? plan.created_at;
    const lines: string[] = [
      `Plan ${perPlan.length - i} — ${plan.status.toUpperCase()}${when ? ` (${when})` : ""}`,
      `  Request: ${clip(String(plan.user_request ?? ""), 400)}`,
    ];
    if (plan.plan_summary) lines.push(`  Plan: ${clip(String(plan.plan_summary), MAX_SUMMARY_CHARS)}`);
    if (plan.result_summary) lines.push(`  What it did:\n${clip(String(plan.result_summary), MAX_SUMMARY_CHARS)}`);
    if (plan.status === "failed" && plan.error_message) {
      lines.push(`  Failure: ${clip(String(plan.error_message), 300)}`);
    }
    const docs = artifacts.documentIds
      .map((id) => `${docTitles.get(id) ?? "Untitled"} (${id})`)
      .slice(0, 12);
    if (docs.length) lines.push(`  Documents involved: ${docs.join("; ")}`);
    const media = artifacts.mediaIds
      .map((id) => `${mediaTitles.get(id) ?? "media"} (${id})`)
      .slice(0, 12);
    if (media.length) lines.push(`  Media created/used: ${media.join("; ")}`);
    if (artifacts.scheduleIds.length) {
      lines.push(`  Schedules touched: ${artifacts.scheduleIds.slice(0, 6).join("; ")}`);
    }
    return lines.join("\n");
  });

  let block =
    "[Workspace memory — plans already completed earlier in THIS conversation]\n" +
    "These plans really ran. Their documents, sentences and media exist right now in the user's workspace. " +
    "Treat them as established facts: never re-ask for information they already produced, never redo them, " +
    "and when the user says \"that doc\", \"the images you made\", \"keep going\", etc., resolve it against this list " +
    "and reuse the exact ids below.\n\n" +
    planBlocks.join("\n\n");

  // Inline the current text of the most recently touched docs so follow-up
  // questions ("what did you write?") can be answered without re-attaching.
  const exclude = new Set(opts.excludeDocIds ?? []);
  const inlineIds = orderedDocIds.filter((id) => !exclude.has(id)).slice(0, INLINE_DOC_COUNT);
  if (opts.inlineDocs !== false && inlineIds.length) {
    const parts: string[] = [];
    for (const id of inlineIds) {
      const text = await readDocumentText(supabase, id);
      if (text) parts.push(`[document "${docTitles.get(id) ?? "Untitled"}" (${id}) — current content]\n${text}`);
    }
    if (parts.length) {
      block += `\n\n[Current content of the documents these plans touched]\n${parts.join("\n\n")}`;
    }
    const rest = orderedDocIds.filter((id) => !inlineIds.includes(id) && !exclude.has(id));
    if (rest.length) {
      block +=
        `\n\nOther documents from earlier plans (not inlined — a follow-up plan can target them by id): ` +
        rest.slice(0, 20).map((id) => `${docTitles.get(id) ?? "Untitled"} (${id})`).join("; ");
    }
  }

  const latest = perPlan[0];
  const latestDocs = latest.artifacts.documentIds
    .map((id) => `${docTitles.get(id) ?? "Untitled"} (${id})`)
    .slice(0, 3)
    .join(", ");
  const digest =
    `Earlier in this conversation Orby ran ${perPlan.length} plan(s). Most recent: ` +
    `"${clip(String(latest.plan.user_request ?? ""), 160)}" → ${latest.plan.status}` +
    (latestDocs ? `, touching ${latestDocs}` : "") +
    (latest.artifacts.mediaIds.length ? `, and created ${latest.artifacts.mediaIds.length} media item(s)` : "") +
    ".";

  return { block, digest, documentIds: orderedDocIds };
}
