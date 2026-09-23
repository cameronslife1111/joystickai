// Server-only: reflex mode for the Virtual Computer.
//
// Instead of handing the whole errand to a hosted browser robot that thinks
// with a big model before every click, Orby drives a throwaway cloud browser
// herself:
//
//   page  ->  plain-text list of clickable things  ->  Jev picks one (~50ms)
//             ->  the click/typing happens  ->  repeat
//
// The big model is used twice per errand: once to break the goal into
// sub-goals and gather the literal values that may need typing, once at the
// end to write the answer for the chat. Anything confusing is handed back to
// the old hosted robot, so worst case is the previous behaviour.
import { generateText } from "ai";

import { createOpenAiProvider } from "./ai-gateway";
import { askJev, JevError, noulOf, pickChoice, type JevQuestion } from "./jev.server";
import {
  bu,
  buSoft,
  decryptValue,
  ensureProfile,
  finishFail,
  finishOk,
  hostOf,
  loadRun,
  normalizeDomains,
  patch,
  postChat,
  shutdown,
  VC_MAX_RUNTIME_MS,
  type VcResult,
  type VcRunRow,
} from "./vc.server";
import {
  clickAt,
  findPageSocket,
  goBack,
  harvest,
  navigate,
  openCdp,
  pressEnter,
  scrollBy,
  settle,
  typeInto,
  type Cdp,
  type PageEl,
  type PageView,
} from "./vc-cdp.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Total actions one errand may take before it gives up. */
export const VC_MAX_ACTIONS = 140;
/** How many actions one invocation performs before returning. */
const BURST_ACTIONS = 6;
/** Wall clock budget for a single invocation. */
const BURST_MS = 11_000;
/** Below this, Jev isn't sure enough — hand over to the slower robot. */
const MIN_CONFIDENCE = 0.34;
/** How many identical-looking pages in a row count as stuck. */
const STUCK_LIMIT = 4;
/** The cloud browser's own lifetime, in minutes. */
const BROWSER_MINUTES = 12;

const db = () => supabaseAdmin as any;

type ReflexRow = VcRunRow & {
  mode: string | null;
  cdp_url: string | null;
  page_ws: string | null;
  action_count: number | null;
  actions: unknown;
  sub_goals: unknown;
  type_values: unknown;
  no_progress: number | null;
};

type ActionLog = { at: string; what: string };

// ------------------------------------------------------------- big model ---

async function bigModel() {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return createOpenAiProvider(key)("gpt-6-luna");
}

/**
 * One planning call: the errand broken into short sub-goals, plus every
 * literal string that may have to be typed into a field (emails, search
 * terms, names, amounts). Jev only ever picks from this list — it never
 * invents text.
 */
async function strategise(row: ReflexRow): Promise<{ subGoals: string[]; values: string[] }> {
  const fallback = { subGoals: [row.task.slice(0, 200)], values: [] as string[] };
  try {
    const { text } = await generateText({
      model: await bigModel(),
      prompt:
        "You are preparing a web errand for a fast browser operator that can only PICK from lists — it cannot write text.\n" +
        "Return JSON only, no prose, shaped exactly: " +
        '{"sub_goals":["..."],"values":["..."]}\n' +
        "sub_goals: 2 to 6 very short steps, in order, describing the outcome of each (no UI instructions).\n" +
        "values: every literal string that may need typing into a field to do this errand — email addresses, " +
        "usernames, search terms, names, dates, amounts, urls. Copy them exactly from the errand. Never invent " +
        "credentials and never include a password.\n\n" +
        `ERRAND: ${row.task}\n` +
        (row.start_url ? `START URL: ${row.start_url}\n` : ""),
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    const subGoals = Array.isArray(parsed.sub_goals)
      ? parsed.sub_goals.map((s: unknown) => String(s).slice(0, 160)).filter(Boolean).slice(0, 6)
      : [];
    const values = Array.isArray(parsed.values)
      ? parsed.values.map((s: unknown) => String(s).slice(0, 200)).filter(Boolean).slice(0, 12)
      : [];
    return { subGoals: subGoals.length ? subGoals : fallback.subGoals, values };
  } catch (e) {
    console.warn("[vc reflex] strategise failed", String((e as any)?.message ?? e));
    return fallback;
  }
}

/** One writing call at the end: the outcome, in the user's words. */
async function summarise(row: ReflexRow, page: PageView, log: ActionLog[]): Promise<string> {
  try {
    const { text } = await generateText({
      model: await bigModel(),
      prompt:
        "A cloud browser just carried out an errand for the user. Write the outcome for them in plain text, " +
        "2 to 5 sentences, no markdown, including any figures, confirmations or reference numbers on the page. " +
        "If the errand clearly could not be completed, say so plainly and why.\n\n" +
        `ERRAND: ${row.task}\n\n` +
        `WHAT WAS DONE: ${log.slice(-14).map((a) => a.what).join(" → ")}\n\n` +
        `FINAL PAGE (${page.url}) TITLE: ${page.title}\n` +
        `FINAL PAGE TEXT: ${page.text.slice(0, 2400)}`,
    });
    return text.trim() || "The task finished.";
  } catch {
    return `Finished on ${page.url}. ${page.text.slice(0, 600)}`;
  }
}

// ---------------------------------------------------------------- secrets ---

type Held = { id: string; value: string; oneTime: boolean; kind: string; secretish: boolean };

/** Everything the user has handed over for this site. Never logged. */
async function savedSecrets(userId: string, domain: string | null): Promise<Held[]> {
  if (!domain) return [];
  const { data } = await db()
    .from("vc_secrets")
    .select("id, domain, alias, label, cipher, one_time")
    .eq("user_id", userId)
    .in("domain", [domain, domain.replace(/^www\./, "")]);
  const out: Held[] = [];
  for (const row of data ?? []) {
    try {
      const kind = String(row.label ?? "password");
      out.push({
        id: String(row.id),
        value: await decryptValue(row.cipher),
        oneTime: Boolean(row.one_time),
        kind,
        secretish: /password|code/i.test(kind),
      });
    } catch {
      /* unreadable — ignore */
    }
  }
  return out;
}

// ------------------------------------------------------------------ start ---

/** Book a cloud browser and drive it ourselves. */
export async function startReflexRun(runId: string): Promise<VcResult> {
  const row = (await loadRun(runId)) as ReflexRow | null;
  if (!row) return { ok: false as const, error: "run not found" };
  try {
    const profileId = await ensureProfile(row.user_id);
    const created = await bu("/browsers", {
      method: "POST",
      body: JSON.stringify({
        ...(profileId ? { profileId } : {}),
        proxyCountryCode: "us",
        timeout: BROWSER_MINUTES,
        solveCaptchas: true,
        enableRecording: false,
        browserScreenWidth: 1280,
        browserScreenHeight: 900,
      }),
    });
    const browserId = String(created?.id ?? "");
    const cdpUrl = created?.cdpUrl ? String(created.cdpUrl) : "";
    if (!browserId || !cdpUrl) throw new Error("the cloud browser didn't come up");

    const plan = await strategise(row);
    await patch(row.id, {
      mode: "reflex",
      browser_id: browserId,
      cdp_url: cdpUrl,
      live_view_url: created?.liveUrl ? String(created.liveUrl) : null,
      status: "running",
      attempts: (row.attempts ?? 0) + 1,
      sub_goals: plan.subGoals,
      type_values: plan.values,
      phase_text: "Opening the browser…",
      action_count: 0,
      actions: [],
      no_progress: 0,
      deadline_at: new Date(Date.now() + VC_MAX_RUNTIME_MS).toISOString(),
      poll_at: new Date().toISOString(),
    });
    return { ok: true as const };
  } catch (e) {
    // If Orby can't get her own hands on a browser, fall back to the robot.
    console.warn("[vc reflex] start failed", String((e as any)?.message ?? e));
    return await escalate(row, "the fast browser couldn't start");
  }
}

// -------------------------------------------------------------- escalation ---

/**
 * Hand the errand to the hosted robot (today's path). The saved profile keeps
 * whatever the fast pass signed into, so nothing is lost.
 */
export async function escalate(row: ReflexRow, why: string): Promise<VcResult> {
  await shutdown(row);
  await patch(row.id, {
    mode: "agent",
    escalated_at: new Date().toISOString(),
    cdp_url: null,
    page_ws: null,
    browser_id: null,
    session_id: null,
    live_view_url: null,
    provider_run_id: null,
    status: "starting",
    phase_text: "Taking the slower, more careful route…",
  });
  console.log("[vc reflex] escalating", row.id, why);
  const { startVcRun } = await import("./vc.server");
  return await startVcRun(row.id);
}

// --------------------------------------------------------------- the loop ---

/**
 * A cheap "is this still the same page in the same state" print. Filled-in
 * boxes and ticked options count, so choosing a size or typing into a field
 * registers as progress even when the page itself doesn't reload.
 */
function fingerprint(page: PageView): string {
  const filled = page.els.map((el) => (el.filled ? "1" : "0")).join("");
  return `${page.url}|${page.els.length}|${filled}|${page.text.slice(0, 160)}`;
}

function elLabel(el: PageEl): string {
  const tick = el.type === "radio" || el.type === "checkbox";
  const kind = tick
    ? `${el.type === "radio" ? "choice option" : "tick box"} (${el.checked ? "already chosen" : "not chosen"})`
    : el.tag === "input" || el.tag === "textarea"
      ? el.secret
        ? "password box"
        : `text box${el.type && el.type !== "text" ? ` (${el.type})` : ""}`
      : el.tag === "select"
        ? "dropdown"
        : el.tag === "a"
          ? "link"
          : "button";
  const where = el.onScreen ? "on screen" : "further down the page";
  const filled = !tick && el.filled ? ", already filled in" : "";
  return `${kind} labelled "${el.label || "(no label)"}", ${where}${filled}${el.href ? `, goes to ${el.href}` : ""}`;
}

function humanPhase(verb: string, el: PageEl | null, page: PageView): string {
  const site = hostOf(page.url) ?? "the page";
  switch (verb) {
    case "click":
      return `Pressing "${el?.label || "a button"}" on ${site}`;
    case "type":
      return el?.secret ? `Typing the saved password on ${site}` : `Filling in "${el?.label || "a box"}" on ${site}`;
    case "ask_user":
      return `Asking you for "${el?.label || "a detail"}" on ${site}`;
    case "enter":
      return `Submitting the form on ${site}`;
    case "scroll_down":
      return `Reading further down ${site}`;
    case "scroll_up":
      return `Looking back up ${site}`;
    case "back":
      return `Going back a page on ${site}`;
    default:
      return `Working on ${site}`;
  }
}

/**
 * Push a reflex run forward by a burst of actions. Safe to call as often as
 * you like; each call opens a socket, acts, and closes it.
 */
export async function reflexTick(runId: string): Promise<VcResult> {
  const row = (await loadRun(runId)) as ReflexRow | null;
  if (!row) return { ok: false as const, error: "run not found" };
  // A freshly queued errand ("starting") has no machine yet — book one instead
  // of waiting on itself forever.
  if (!row.cdp_url && (row.status === "starting" || row.status === "running")) {
    return await startReflexRun(row.id);
  }
  if (row.status !== "running") return { ok: true as const, status: row.status };


  if (Date.parse(row.deadline_at) < Date.now()) {
    await finishFail(row, `The task hit its ${Math.round(VC_MAX_RUNTIME_MS / 60_000)}-minute limit and was stopped.`);
    return { ok: true as const, status: "failed" };
  }

  if ((row.action_count ?? 0) >= VC_MAX_ACTIONS) {
    return await escalate(row, "too many steps in fast mode");
  }

  let cdp: Cdp | null = null;
  const log: ActionLog[] = Array.isArray(row.actions) ? (row.actions as ActionLog[]) : [];
  let actions = row.action_count ?? 0;
  let noProgress = row.no_progress ?? 0;
  let lastPrint = "";
  let lastMove = "";
  const typedBoxes = new Set<string>();

  try {
    const wsUrl = row.page_ws ?? (await findPageSocket(String(row.cdp_url)));
    if (!wsUrl) return await escalate(row, "no page to drive");
    if (wsUrl !== row.page_ws) await patch(row.id, { page_ws: wsUrl });

    cdp = await openCdp(wsUrl);
    await cdp.send("Page.enable").catch(() => null);
    await cdp.send("Runtime.enable").catch(() => null);

    const started = Date.now();
    const subGoals = Array.isArray(row.sub_goals) ? (row.sub_goals as string[]) : [];
    const values = Array.isArray(row.type_values) ? (row.type_values as string[]) : [];

    if (actions === 0 && row.start_url) {
      await navigate(cdp, row.start_url);
      await settle(1800);
    }

    for (let burst = 0; burst < BURST_ACTIONS && Date.now() - started < BURST_MS; burst++) {
      const page = await harvest(cdp);
      const print = fingerprint(page);
      const samePage = print === lastPrint;
      lastPrint = print;

      const domain = hostOf(page.url);
      const held = await savedSecrets(row.user_id, domain);
      const secret = held.find((h) => h.secretish) ?? null;

      // The answer space Jev picks from: real elements plus a few verbs.
      const elements: Record<string, unknown> = {};
      for (const el of page.els.slice(0, 80)) elements[`e${el.i}`] = elLabel(el);
      elements["none"] = "No element should be touched; do something else instead.";

      const verbs: Record<string, unknown> = {
        click: "Press the chosen element (button, link, tab, checkbox).",
        type: "Type one of the listed values into the chosen text box, where that value plainly belongs in it.",
        ask_user:
          "The chosen box needs a detail none of the listed values covers — a name, address, phone number, card detail, code or answer the user never gave. Stop and ask them for it.",
        enter: "Press Enter to submit what is already typed in.",
        scroll_down: "Nothing useful is visible yet; move further down the page.",
        scroll_up: "Move back up the page.",
        back: "This page is a dead end; go back to the previous one.",
        finish: "The errand's goal is already achieved and the answer is on this page.",
        escalate: "This page is confusing, blocked, or needs judgement beyond simple clicking.",
      };

      const valueOptions: Record<string, unknown> = {};
      values.forEach((v, i) => {
        valueOptions[`v${i}`] = `The literal text: ${v}`;
      });
      held.forEach((h, i) => {
        valueOptions[`h${i}`] = `The ${h.kind} the user handed over for ${domain} (its characters are hidden from you).`;
      });
      if (!Object.keys(valueOptions).length)
        valueOptions["none"] = "There is no value available to type.";

      const state = {
        errand: row.task,
        sub_goals: subGoals,
        steps_taken: log.slice(-8).map((a) => a.what),
        page: { url: page.url, title: page.title, visible_text: page.text.slice(0, 2200) },
        room_to_scroll: page.scrollRoom,
        elements: page.els.slice(0, 80).map((el) => ({ id: `e${el.i}`, what: elLabel(el) })),
        things_the_user_handed_over: held.map((h) => h.kind),
        saved_credential_available: Boolean(secret),
      };

      const questions: Record<string, JevQuestion> = {
        verb: {
          type: "choice",
          instructions:
            "Pick the single next action that best advances `errand` from the current `page`. Prefer acting on something already visible.",
          criteria: verbs,
        },
        element: {
          type: "choice",
          instructions:
            "Which element in `elements` should that action be applied to? Match the element's purpose to the current sub-goal. Choose `none` only when no element is involved.",
          criteria: elements,
        },
        value: {
          type: "choice",
          instructions:
            "If a text box is being filled in, which available value belongs in it? Match the box's label to the value's meaning.",
          criteria: valueOptions,
        },
        done: {
          type: "noul",
          instructions: "Is the whole `errand` already accomplished, with its answer visible in `page.visible_text`?",
          criteria: {
            true: "The requested outcome is complete and the needed information or confirmation is on this page.",
            false: "Work remains, or the page does not yet show the requested outcome.",
          },
        },
        needs_credential: {
          type: "noul",
          instructions:
            "Does this page demand a password, a texted or emailed verification code, or a human puzzle, that is not already available (`saved_credential_available`)?",
          criteria: {
            true: "A sign-in, verification code, or human check blocks any further progress right now.",
            false: "Progress is possible by clicking, typing available values, or scrolling.",
          },
        },
      };

      const answers = await askJev(state, questions);
      const verb = pickChoice(answers["verb"]);
      const element = pickChoice(answers["element"]);
      const value = pickChoice(answers["value"]);
      const done = noulOf(answers["done"]);
      const needsCred = noulOf(answers["needs_credential"]);

      if (!verb) return await escalate(row, "no decision came back");

      // Stuck means the same move on an unchanged page, over and over.
      const move = `${verb.id}:${element?.id ?? "-"}`;
      noProgress = samePage && move === lastMove ? noProgress + 1 : 0;
      lastMove = move;
      if (noProgress >= STUCK_LIMIT) {
        await patch(row.id, { action_count: actions, actions: log.slice(-40), no_progress: noProgress });
        return await escalate(row, "the page stopped changing");
      }

      // Finished?
      if (done > 0.72 || verb.id === "finish") {
        const summary = await summarise(row, page, log);
        await patch(row.id, { action_count: actions, actions: log.slice(-40), no_progress: 0 });
        cdp.close();
        cdp = null;
        await finishOk(row as VcRunRow, summary, null);
        return { ok: true as const, status: "completed" };
      }

      // Blocked on a credential we do not hold: ask the user, in the chat.
      if (needsCred > 0.7 && !secret) {
        const kind = /code|verification|otp|one[- ]time/i.test(page.text.slice(0, 1200)) ? "code" : "password";
        await patch(row.id, {
          status: "awaiting_secret",
          action_count: actions,
          actions: log.slice(-40),
          phase_text: kind === "code" ? "Waiting for your verification code" : "Waiting for your password",
          secret_request: {
            alias: kind === "code" ? "otp_code" : "site_password",
            domain: domain ?? "",
            kind,
            ask: kind === "code" ? "Please paste the code you were sent." : "Please enter the password for this site.",
            asked_at: new Date().toISOString(),
          },
        });
        await postChat(
          row,
          kind === "code"
            ? `I need the verification code for ${domain}. Tap the locked box on the virtual computer card — it goes straight into the page and is never kept in this chat.`
            : `I need the password for ${domain}. Tap the locked box on the virtual computer card — it is typed straight into the page, never shown to me, and never kept in this chat.`,
        );
        return { ok: true as const, status: "awaiting_secret" };
      }

      // Filling in a box is the safest move there is: either a known value goes
      // in, or the user is asked for it. So it needs less certainty than the rest.
      const floor = verb.id === "type" || verb.id === "ask_user" ? MIN_CONFIDENCE * 0.6 : MIN_CONFIDENCE;
      if (verb.id === "escalate" || verb.confidence < floor) {
        await patch(row.id, { action_count: actions, actions: log.slice(-40) });
        return await escalate(row, `unsure (${verb.id}, ${verb.confidence.toFixed(2)})`);
      }

      const chosen =
        element && element.id !== "none" ? (page.els.find((el) => `e${el.i}` === element.id) ?? null) : null;

      // Ask the user for one detail this page needs, in the chat — unless they
      // already answered this exact box, in which case use their answer.
      const askForField = async (el: PageEl): Promise<VcResult | null> => {
        const field = (el.label || "this box").slice(0, 80);
        const answered = held.find((h) => h.kind.trim().toLowerCase() === field.trim().toLowerCase());
        if (answered) {
          // Keep a form answer for the rest of the errand so the same box is
          // never asked about twice.
          typedBoxes.add(`${el.i}|${el.label}`);
          await typeInto(cdp!, el, answered.value);
          return null;
        }
        await patch(row.id, {
          status: "awaiting_secret",
          action_count: actions,
          actions: log.slice(-40),
          phase_text: `Waiting for what to put in "${field}"`,
          secret_request: {
            alias: `field_${field.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`,
            domain: domain ?? "",
            kind: el.secret ? "password" : "info",
            field,
            ask: el.secret
              ? `Please enter the password for ${domain ?? "this site"}.`
              : `What should I put in "${field}" on ${domain ?? "this page"}?`,
            asked_at: new Date().toISOString(),
          },
        });
        await postChat(
          row,
          el.secret
            ? `I need the password for ${domain}. Tap the locked box on the virtual computer card — it goes straight into the page and is never kept in this chat.`
            : `The form on ${domain ?? "this page"} is asking for "${field}" and I don't have it. Type it into the box on the virtual computer card and I'll carry straight on.`,
        );
        return { ok: true as const, status: "awaiting_secret" };
      };

      // Do it.
      switch (verb.id) {
        case "click":
          if (!chosen) {
            await scrollBy(cdp, 600);
            break;
          }
          await clickAt(cdp, chosen.x, chosen.y);
          break;
        case "ask_user":
          if (!chosen) {
            await scrollBy(cdp, 500);
            break;
          }
          {
            const asked = await askForField(chosen);
            if (asked) return asked;
          }
          break;
        case "type": {
          if (!chosen) {
            await scrollBy(cdp, 600);
            break;
          }
          let text: string | null = null;
          let used: Held | null = null;
          if (value && value.id.startsWith("h")) {
            used = held[Number(value.id.slice(1))] ?? null;
            text = used?.value ?? null;
          } else if (value && value.id.startsWith("v")) {
            text = values[Number(value.id.slice(1))] ?? null;
          } else if (chosen.secret && secret) {
            used = secret;
            text = secret.value;
          }
          // Once a box has been filled, going back to it means the value Orby
          // had wasn't the right one — so ask the user rather than repeat.
          const boxKey = `${chosen.i}|${chosen.label}`;
          if (typedBoxes.has(boxKey)) text = null;
          if (used?.oneTime) await db().from("vc_secrets").delete().eq("id", used.id);
          if (!text) {
            const asked = await askForField(chosen);
            if (asked) return asked;
            break;
          }
          typedBoxes.add(boxKey);
          await typeInto(cdp, chosen, text);
          break;
        }
        case "enter":
          await pressEnter(cdp);
          break;
        case "scroll_down":
          await scrollBy(cdp, 700);
          break;
        case "scroll_up":
          await scrollBy(cdp, -700);
          break;
        case "back":
          await goBack(cdp);
          break;
        default:
          await scrollBy(cdp, 500);
      }

      actions += 1;
      const phrase = humanPhase(verb.id, chosen, page);
      log.push({ at: new Date().toISOString(), what: phrase });
      await patch(row.id, {
        action_count: actions,
        actions: log.slice(-40),
        no_progress: noProgress,
        phase_text: phrase.slice(0, 180),
        poll_at: new Date().toISOString(),
      });

      await settle(verb.id === "click" || verb.id === "enter" ? 1400 : 700);
      if (actions >= VC_MAX_ACTIONS) break;
    }

    await patch(row.id, {
      action_count: actions,
      actions: log.slice(-40),
      no_progress: noProgress,
      poll_at: new Date().toISOString(),
    });
    return { ok: true as const, status: "running", actions };
  } catch (e) {
    const message = String((e as any)?.message ?? e);
    console.warn("[vc reflex] tick failed", message);
    if (e instanceof JevError && e.status === 401) {
      await finishFail(row, "The instant decision engine rejected the TypeSafe key, so the task was stopped.");
      return { ok: false as const, error: message };
    }
    // A page that navigated mid-command is normal browsing, not a dead end:
    // drop the stale window handle and pick the page up again next poke.
    const hiccup = /navigated or closed|couldn't read the page|timed out|socket/i.test(message);
    if (hiccup && noProgress + 1 < STUCK_LIMIT) {
      await patch(row.id, {
        page_ws: null,
        action_count: actions,
        actions: log.slice(-40),
        no_progress: noProgress + 1,
        poll_at: new Date().toISOString(),
      });
      return { ok: true as const, status: "running", actions };
    }
    // Anything else: the slower robot finishes the job.
    return await escalate(row, message);
  } finally {
    cdp?.close();
  }
}

/** After a password arrives, carry on in the same browser window. */
export async function resumeReflexAfterSecret(runId: string): Promise<VcResult> {
  const row = (await loadRun(runId)) as ReflexRow | null;
  if (!row) return { ok: false as const, error: "run not found" };
  await patch(row.id, {
    status: "running",
    secret_request: null,
    phase_text: "Signing in…",
    no_progress: 0,
    deadline_at: new Date(Date.now() + VC_MAX_RUNTIME_MS).toISOString(),
  });
  return await reflexTick(runId);
}
