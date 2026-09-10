// Server-only: the Virtual Computer.
//
// Orby rents a throwaway cloud browser (Browser Use Cloud, API v4), does the
// task, reports the result back into the chat, and shuts the machine down. It
// never touches the user's own Mac or their personal browser.
//
// Credentials never reach any model: they are handed to the provider as
// domain-scoped `secretBindings`, which type the value straight into the page.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const API = "https://api.browser-use.com/api/v4";

/** Browser Use v4's own default, and the cheapest capable computer-use model. */
export const VC_MODEL = "gpt-5.6-luna";
/** Balanced limits — enforced here, never left to the model. */
export const VC_MAX_RUNTIME_MS = 8 * 60_000;
export const VC_MAX_ATTEMPTS = 3; // first try + 2 retries
export const VC_MAX_COST_USD = 0.5;
/** How long a run may sit waiting for a password before it gives up. */
export const VC_SECRET_WAIT_MS = 15 * 60_000;
/** One machine per person at a time. */
export const VC_MAX_ACTIVE_PER_USER = 1;

export const VC_ACTIVE_STATUSES = ["starting", "running", "awaiting_secret"] as const;
const NEED_SECRET = "NEED_SECRET";

export type VcRunRow = {
  id: string;
  user_id: string;
  plan_id: string | null;
  step_index: number | null;
  thread_id: string | null;
  task: string;
  start_url: string | null;
  allowed_domains: string[] | null;
  provider_run_id: string | null;
  session_id: string | null;
  browser_id: string | null;
  live_view_url: string | null;
  status: string;
  phase_text: string | null;
  result: string | null;
  error: string | null;
  attempts: number;
  secret_request: Record<string, unknown> | null;
  deadline_at: string;
  updated_at: string;
};

const db = () => supabaseAdmin as any;

// ---------------------------------------------------------------- provider ---

async function bu(path: string, init: RequestInit = {}): Promise<any> {
  const key = process.env["BROWSER_USE_API_KEY"];
  if (!key) throw new Error("The virtual computer isn't set up yet (missing Browser Use API key).");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Browser Use uses a bare key header, not "Bearer".
      "X-Browser-Use-API-Key": key,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => "");
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = (body && (body.detail ?? body.message ?? body.error)) || text.slice(0, 300) || res.statusText;
    throw new Error(`browser-use ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return body;
}

/** Best-effort provider call — never fail a run over a nice-to-have. */
async function buSoft(path: string, init: RequestInit = {}): Promise<any | null> {
  try {
    return await bu(path, init);
  } catch (e) {
    console.warn("[vc] soft call failed", path, String((e as any)?.message ?? e));
    return null;
  }
}

// ------------------------------------------------------------- encryption ---

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env["VC_SECRET_KEY"];
  if (!secret) throw new Error("Missing VC_SECRET_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptValue(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(value));
  const bytes = new Uint8Array(buf);
  const joined = new Uint8Array(iv.length + bytes.length);
  joined.set(iv, 0);
  joined.set(bytes, iv.length);
  let b64 = "";
  for (const byte of joined) b64 += String.fromCharCode(byte);
  return btoa(b64);
}

async function decryptValue(cipher: string): Promise<string> {
  const raw = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await aesKey(),
    raw.slice(12),
  );
  return new TextDecoder().decode(buf);
}

// ------------------------------------------------------------------ helpers ---

function hostOf(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeDomains(row: Pick<VcRunRow, "allowed_domains" | "start_url">): string[] {
  const out = new Set<string>();
  for (const d of row.allowed_domains ?? []) {
    const h = hostOf(String(d));
    if (h) out.add(h);
  }
  if (row.start_url) {
    const h = hostOf(row.start_url);
    if (h) out.add(h);
  }
  return [...out];
}

async function patch(runId: string, updates: Record<string, unknown>) {
  await db().from("vc_runs").update(updates).eq("id", runId);
}

async function loadRun(runId: string): Promise<VcRunRow | null> {
  const { data } = await db().from("vc_runs").select("*").eq("id", runId).maybeSingle();
  return (data as VcRunRow | null) ?? null;
}

async function ensureProfile(userId: string): Promise<string | null> {
  const { data: existing } = await db()
    .from("vc_profiles")
    .select("provider_profile_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.provider_profile_id) return String(existing.provider_profile_id);

  // A saved profile keeps cookies between tasks — that's what "ask once" relies on.
  const created = await buSoft("/profiles", {
    method: "POST",
    body: JSON.stringify({ name: `orby-${userId.slice(0, 8)}` }),
  });
  const id = created?.id ?? created?.profileId ?? null;
  if (!id) return null;
  await db()
    .from("vc_profiles")
    .upsert({ user_id: userId, provider_profile_id: String(id) }, { onConflict: "user_id" });
  return String(id);
}

type Binding = { alias: string; source: { type: "inline"; value: string }; allowedDomains: string[] };

async function loadBindings(userId: string, domains: string[]) {
  const bindings: Binding[] = [];
  const aliases: { alias: string; domain: string; label: string | null }[] = [];
  if (!domains.length) return { bindings, aliases };
  const { data } = await db()
    .from("vc_secrets")
    .select("id, domain, alias, label, cipher, one_time")
    .eq("user_id", userId)
    .in("domain", domains);
  const spent: string[] = [];
  for (const row of (data ?? []) as any[]) {
    if (bindings.length >= 10) break;
    try {
      bindings.push({
        alias: row.alias,
        source: { type: "inline", value: await decryptValue(row.cipher) },
        allowedDomains: [row.domain, `*.${row.domain}`],
      });
      aliases.push({ alias: row.alias, domain: row.domain, label: row.label ?? null });
      if (row.one_time) spent.push(row.id);
    } catch (e) {
      console.error("[vc] secret decrypt failed", String((e as any)?.message ?? e));
    }
  }
  // A texted code is good once only.
  if (spent.length) await db().from("vc_secrets").delete().in("id", spent);
  return { bindings, aliases };
}

function buildTask(
  row: VcRunRow,
  aliases: { alias: string; domain: string; label: string | null }[],
  extra = "",
): string {
  const domains = normalizeDomains(row);
  return [
    row.task,
    row.start_url ? `\nStart at: ${row.start_url}` : "",
    "",
    "OPERATING RULES:",
    "- You are working in a temporary cloud browser on the user's behalf. Be efficient; fewer page loads is better.",
    domains.length
      ? `- Stay on these sites unless the task is impossible otherwise: ${domains.join(", ")}.`
      : "- Stay on the sites the task needs.",
    "- Never buy anything, never move money, never delete an account, and never post publicly unless the task explicitly says to.",
    aliases.length
      ? `- Saved credentials are available as placeholders you can type into the matching field: ${aliases
          .map((a) => `${a.alias} (${a.label ?? a.alias} for ${a.domain})`)
          .join("; ")}. Type the placeholder; the real value is filled in for you and you never see it.`
      : "",
    `- If you need a password, a login, or a texted/emailed verification code you do not already have, STOP at once and finish with exactly: ${NEED_SECRET}|<site domain>|<password or code>|<one short sentence asking the user for it>. Never guess credentials and never create accounts.`,
    "- When finished, state the outcome plainly in a few sentences, including any figures, confirmations or reference numbers the user needs.",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}

async function createProviderRun(row: VcRunRow, extra = "") {
  const domains = normalizeDomains(row);
  const { bindings, aliases } = await loadBindings(row.user_id, domains);
  const profileId = await ensureProfile(row.user_id);
  const body: Record<string, unknown> = {
    task: buildTask(row, aliases, extra),
    model: VC_MODEL,
    maxCostUsd: VC_MAX_COST_USD,
    browserSettings: { ...(profileId ? { profileId } : {}), record: false },
    ...(bindings.length ? { secretBindings: bindings } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
  };
  const created = await bu("/runs", { method: "POST", body: JSON.stringify(body) });
  return {
    runId: String(created?.id ?? created?.runId ?? ""),
    sessionId: created?.sessionId ? String(created.sessionId) : row.session_id,
  };
}

/**
 * The watch-along window and the machine id both live on the provider's
 * browser list, keyed by the agent session. (Verified against the live API:
 * GET /browsers -> items[].agentSessionId / liveUrl / id.)
 */
async function fetchBrowser(
  sessionId: string | null,
): Promise<{ liveUrl: string | null; browserId: string | null }> {
  if (!sessionId) return { liveUrl: null, browserId: null };
  const list = await buSoft(`/browsers`);
  const items: any[] = Array.isArray(list) ? list : (list?.items ?? list?.browsers ?? []);
  const hit = items.find(
    (b) => String(b?.agentSessionId ?? b?.agent_session_id ?? "") === sessionId,
  );
  if (!hit) return { liveUrl: null, browserId: null };
  return {
    liveUrl: hit.liveUrl ? String(hit.liveUrl) : null,
    browserId: hit.id ? String(hit.id) : null,
  };
}

/** Always shut the machine down — this is where the money goes. */
async function shutdown(row: Pick<VcRunRow, "session_id" | "browser_id">) {
  if (row.browser_id)
    await buSoft(`/browsers/${row.browser_id}`, { method: "PATCH", body: JSON.stringify({ action: "stop" }) });
  if (row.session_id) {
    await buSoft(`/sessions/${row.session_id}/stop?strategy=session`, { method: "POST" });
    await buSoft(`/sessions/${row.session_id}`, { method: "DELETE" });
  }
}

async function postChat(row: VcRunRow, content: string) {
  if (!row.thread_id) return;
  try {
    const now = new Date().toISOString();
    await db().from("chat_messages").insert({
      user_id: row.user_id,
      thread_id: row.thread_id,
      role: "assistant",
      content,
      kind: "text",
      plan_id: row.plan_id ?? null,
    });
    await db().from("chat_threads").update({ updated_at: now, last_assistant_at: now }).eq("id", row.thread_id);
  } catch (e) {
    console.error("[vc] chat post failed", String((e as any)?.message ?? e));
  }
}

// ------------------------------------------------------------------ actions ---

export async function startVcRun(runId: string) {
  const row = await loadRun(runId);
  if (!row) return { ok: false, error: "run not found" };
  try {
    const { runId: providerRunId, sessionId } = await createProviderRun(row);
    if (!providerRunId) throw new Error("the provider returned no run id");
    await patch(row.id, {
      provider_run_id: providerRunId,
      session_id: sessionId,
      status: "running",
      attempts: (row.attempts ?? 0) + 1,
      phase_text: "Starting the virtual computer…",
      deadline_at: new Date(Date.now() + VC_MAX_RUNTIME_MS).toISOString(),
      poll_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    const message = String((e as any)?.message ?? e);
    await patch(row.id, { status: "failed", error: message, finished_at: new Date().toISOString() });
    return { ok: false, error: message };
  }
}

function parseSecretRequest(text: string) {
  const idx = text.indexOf(NEED_SECRET);
  if (idx < 0) return null;
  const parts = text.slice(idx).split("\n")[0].split("|").map((p) => p.trim());
  const domain = hostOf(parts[1] ?? "") ?? (parts[1] ?? "").toLowerCase();
  const kind = (parts[2] ?? "password").toLowerCase().includes("code") ? "code" : "password";
  const ask = parts[3] || (kind === "code" ? "Please paste the verification code." : "Please enter the password.");
  return { domain, kind, ask };
}

async function finishOk(row: VcRunRow, result: string, cost: number | null) {
  await shutdown(row);
  await patch(row.id, {
    status: "completed",
    result: result.slice(0, 20_000),
    phase_text: "Done — machine shut down",
    error: null,
    secret_request: null,
    ...(cost != null ? { cost_usd: cost } : {}),
    finished_at: new Date().toISOString(),
  });
  // Plan runs get their wrap-up from the planner; a chat-only errand reports here.
  if (!row.plan_id && result.trim()) await postChat(row, result.trim().slice(0, 8_000));
}

async function finishFail(row: VcRunRow, error: string) {
  await shutdown(row);
  await patch(row.id, {
    status: "failed",
    error: error.slice(0, 2_000),
    phase_text: "Stopped",
    secret_request: null,
    finished_at: new Date().toISOString(),
  });
  if (!row.plan_id) await postChat(row, `🖥️ ${error.slice(0, 500)}`);
}

/** Advance one run by a single step. Safe to call as often as you like. */
export async function pollVcRun(runId: string) {
  const row = await loadRun(runId);
  if (!row) return { ok: false, error: "run not found" };
  if (row.status === "completed" || row.status === "failed" || row.status === "canceled")
    return { ok: true, status: row.status };

  if (row.status === "awaiting_secret") {
    const askedAt = Date.parse(String(row.secret_request?.["asked_at"] ?? row.updated_at)) || Date.now();
    if (Date.now() - askedAt > VC_SECRET_WAIT_MS) {
      await finishFail(row, "No password or code arrived in time, so the virtual computer was shut down.");
      return { ok: true, status: "failed" };
    }
    return { ok: true, status: "awaiting_secret" };
  }

  if (!row.provider_run_id) return await startVcRun(row.id);

  // Hard wall clock — the main runaway guard.
  if (Date.parse(row.deadline_at) < Date.now()) {
    await buSoft(`/runs/${row.provider_run_id}/stop`, { method: "POST" });
    await finishFail(row, `The task hit its ${Math.round(VC_MAX_RUNTIME_MS / 60_000)}-minute limit and was stopped.`);
    return { ok: true, status: "failed" };
  }

  const detail = await buSoft(`/runs/${row.provider_run_id}`);
  if (!detail) {
    await patch(row.id, { poll_at: new Date().toISOString() });
    return { ok: true, status: row.status };
  }
  const status = String(detail.status ?? "running").toLowerCase();
  const sessionId = detail.sessionId ? String(detail.sessionId) : row.session_id;
  const rawCost = detail.totalCostUsd ?? detail.total_cost_usd;
  const cost = rawCost != null && Number.isFinite(Number(rawCost)) ? Number(rawCost) : null;

  const updates: Record<string, unknown> = { poll_at: new Date().toISOString() };
  if (sessionId && sessionId !== row.session_id) updates["session_id"] = sessionId;
  if (cost != null) updates["cost_usd"] = cost;
  if (!row.live_view_url || !row.browser_id) {
    const br = await fetchBrowser(sessionId);
    if (br.liveUrl && !row.live_view_url) updates["live_view_url"] = br.liveUrl;
    if (br.browserId && !row.browser_id) updates["browser_id"] = br.browserId;
  }
  // Plain-language progress: the provider's own short title for the errand.
  const title = String(detail.title ?? "").trim();
  if (title) updates["phase_text"] = title.replace(/\s+/g, " ").slice(0, 180);

  const merged: VcRunRow = { ...row, ...(updates as any), session_id: sessionId };

  if (status === "completed" || status === "finished" || status === "success") {
    const text = String(detail.result ?? detail.output ?? detail.finalResult ?? "").trim();
    const req = parseSecretRequest(text);
    await patch(row.id, updates);
    if (req) {
      const alias = req.kind === "code" ? "otp_code" : "site_password";
      await patch(row.id, {
        status: "awaiting_secret",
        phase_text: req.kind === "code" ? "Waiting for your verification code" : "Waiting for your password",
        secret_request: { alias, domain: req.domain, kind: req.kind, ask: req.ask, asked_at: new Date().toISOString() },
      });
      await postChat(
        merged,
        req.kind === "code"
          ? `I need the verification code for ${req.domain}. ${req.ask} Tap the locked box on the virtual computer card — it goes straight into the page and is never kept in this chat.`
          : `I need the password for ${req.domain}. ${req.ask} Tap the locked box on the virtual computer card — it is typed straight into the page, never shown to me, and never kept in this chat.`,
      );
      return { ok: true, status: "awaiting_secret" };
    }
    await finishOk(merged, text || "The task finished.", cost);
    return { ok: true, status: "completed" };
  }

  if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled" || status === "stopped") {
    const providerError = String(detail.error ?? "The virtual computer couldn't finish the task.");
    const attempts = row.attempts ?? 1;
    if ((status === "failed" || status === "error") && attempts < VC_MAX_ATTEMPTS) {
      // Retry on a fresh machine: a stuck page is the usual cause.
      await shutdown(merged);
      await patch(row.id, {
        ...updates,
        provider_run_id: null,
        session_id: null,
        browser_id: null,
        live_view_url: null,
        status: "starting",
        error: providerError.slice(0, 2_000),
        phase_text: "Retrying on a fresh machine…",
      });
      await startVcRun(row.id);
      return { ok: true, status: "retrying" };
    }
    await patch(row.id, updates);
    await finishFail(merged, providerError);
    return { ok: true, status: "failed" };
  }

  await patch(row.id, updates);
  return { ok: true, status };
}

export async function stopVcRun(runId: string) {
  const row = await loadRun(runId);
  if (!row) return { ok: false, error: "run not found" };
  if (row.provider_run_id) await buSoft(`/runs/${row.provider_run_id}/stop`, { method: "POST" });
  await shutdown(row);
  await patch(row.id, {
    status: "canceled",
    phase_text: "Stopped by you",
    secret_request: null,
    finished_at: new Date().toISOString(),
  });
  return { ok: true, status: "canceled" };
}

/** Store the credential (encrypted) and resume the same browser session. */
export async function submitVcSecret(runId: string, value: string, remember: boolean) {
  const row = await loadRun(runId);
  if (!row) return { ok: false, error: "run not found" };
  const req = (row.secret_request ?? {}) as Record<string, string>;
  const domain = String(req["domain"] ?? "");
  if (!domain || row.status !== "awaiting_secret")
    return { ok: false, error: "Nothing is waiting for a password right now." };
  const alias = String(req["alias"] ?? "site_password");
  const kind = String(req["kind"] ?? "password");
  const oneTime = kind === "code" || !remember;

  await db()
    .from("vc_secrets")
    .upsert(
      {
        user_id: row.user_id,
        domain,
        alias,
        label: kind === "code" ? "verification code" : "password",
        cipher: await encryptValue(value),
        one_time: oneTime,
      },
      { onConflict: "user_id,domain,alias" },
    );

  const resumed: VcRunRow = {
    ...row,
    allowed_domains: [...(row.allowed_domains ?? []), domain],
  };
  try {
    const { runId: providerRunId, sessionId } = await createProviderRun(
      resumed,
      `The credential you asked for is now available as the placeholder ${alias}. Type it into the field that needs it on ${domain} and carry on with the task. If another verification step appears, stop again using the ${NEED_SECRET} format.`,
    );
    await patch(row.id, {
      provider_run_id: providerRunId,
      session_id: sessionId,
      status: "running",
      secret_request: null,
      phase_text: "Signing in…",
      error: null,
      allowed_domains: resumed.allowed_domains,
      deadline_at: new Date(Date.now() + VC_MAX_RUNTIME_MS).toISOString(),
    });
    return { ok: true };
  } catch (e) {
    const message = String((e as any)?.message ?? e);
    await finishFail(row, message);
    return { ok: false, error: message };
  }
}

/** Forget the saved machine profile and every stored credential. */
export async function forgetVcLogins(userId: string) {
  const { data: profile } = await db()
    .from("vc_profiles")
    .select("provider_profile_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.provider_profile_id) await buSoft(`/profiles/${profile.provider_profile_id}`, { method: "DELETE" });
  await db().from("vc_profiles").delete().eq("user_id", userId);
  await db().from("vc_secrets").delete().eq("user_id", userId);
  return { ok: true };
}

/**
 * Queue a task. Called by the chat and by the planner. Refuses a second
 * machine while one is already up for this person.
 */
export async function queueVcRun(input: {
  userId: string;
  task: string;
  startUrl?: string | null;
  allowedDomains?: string[];
  threadId?: string | null;
  planId?: string | null;
  stepIndex?: number | null;
}) {
  const { count } = await db()
    .from("vc_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .in("status", VC_ACTIVE_STATUSES as unknown as string[]);
  if ((count ?? 0) >= VC_MAX_ACTIVE_PER_USER)
    return { ok: false as const, error: "A virtual computer is already running for you. Let it finish or stop it first." };

  const { data, error } = await db()
    .from("vc_runs")
    .insert({
      user_id: input.userId,
      task: input.task.slice(0, 8_000),
      start_url: input.startUrl ?? null,
      allowed_domains: input.allowedDomains ?? [],
      thread_id: input.threadId ?? null,
      plan_id: input.planId ?? null,
      step_index: input.stepIndex ?? null,
      status: "starting",
      phase_text: "Booking a machine…",
      deadline_at: new Date(Date.now() + VC_MAX_RUNTIME_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? "Couldn't queue the task." };
  return { ok: true as const, runId: String(data.id) };
}

/** Watchdog: advance every active run. Used by the minute tick. */
export async function tickVcRuns(limit = 10) {
  const { data } = await db()
    .from("vc_runs")
    .select("id, status")
    .in("status", VC_ACTIVE_STATUSES as unknown as string[])
    .order("updated_at", { ascending: true })
    .limit(limit);
  const results: unknown[] = [];
  for (const row of (data ?? []) as { id: string }[]) {
    try {
      results.push({ id: row.id, ...(await pollVcRun(row.id)) });
    } catch (e) {
      results.push({ id: row.id, error: String((e as any)?.message ?? e) });
    }
  }
  return results;
}
