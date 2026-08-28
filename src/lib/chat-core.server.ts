// Server-only chat core. Shared by the authenticated chat server function and
// the background scheduler (which fires scheduled chat messages with the admin
// client on behalf of a user). Never import this from client code.
import { generateText as aiSdkGenerateText } from "ai";
import { createOpenAiProvider } from "./ai-gateway";
import { buildPlanMemory } from "./plan-memory";
import { toPlainText } from "./plain-text";
import {
  ACTION_GROUPS,
  type ChatCapabilities,
  type ChatRoute,
  type ChatTurnInput,
} from "./chat-types";

async function buildContext(
  supabase: any,
  contextDocumentIds: string[],
): Promise<string> {
  if (!contextDocumentIds.length) return "";
  // Same builder the hands-free voice path uses, so both see identical text.
  const { buildDocumentBlock } = await import("./assistant-context.server");
  const { text } = await buildDocumentBlock(supabase, contextDocumentIds);
  return text;
}


async function runWebSearch(
  query: string,
  transcript = "",
): Promise<{ ok: boolean; text: string }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { ok: false, text: "Web search isn't configured." };
  try {
    const convo = transcript.trim().slice(-16_000);
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content:
              "You are Orby, a helpful assistant. Answer the user's question using up-to-date web information. " +
              "Write a clear, conversational answer in PLAIN TEXT ONLY: never use asterisks, underscores, backticks, '#' headings, or bullet characters. " +
              "Use numbered lists (1. 2. 3.) only when a list truly helps, separate paragraphs with a blank line, and always use normal punctuation. Emojis are fine. " +
              "No inline citation markers like [1] and do not paste raw reference lists." +
              (convo
                ? " You are continuing an ongoing conversation; the transcript is provided as context. Use it to understand what the user is referring to."
                : ""),

          },
          {
            role: "user",
            content: convo
              ? `CONVERSATION SO FAR:\n${convo}\n\nCURRENT REQUEST (the latest turn of that conversation):\n${query}`
              : query,
          },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("[chat webSearch] perplexity error", res.status, t.slice(0, 300));
      return { ok: false, text: "The web search failed." };
    }
    const result: any = await res.json();
    let text: string = result?.choices?.[0]?.message?.content ?? "";
    text = text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").trim();
    if (!text) return { ok: false, text: "I couldn't find anything on that." };
    return { ok: true, text };
  } catch (e) {
    console.warn("[chat webSearch] failed", e);
    return { ok: false, text: "The web search failed." };
  }
}

/**
 * Turn a possibly-elliptical follow-up ("what about prices for that one?") into a
 * standalone search question using the thread transcript. Falls back to the raw
 * message when the rewrite fails or looks unusable.
 */
async function resolveSearchQuery(
  model: any,
  latestText: string,
  transcript: string,
): Promise<string> {
  if (!transcript.trim()) return latestText;
  try {
    const { text } = await aiSdkGenerateText({
      model,
      system:
        "Rewrite the user's latest message as a single, self-contained web search question. " +
        "Resolve every pronoun and shorthand (it, that, those, the second one) into the actual names " +
        "from the conversation. Keep the user's intent exactly; add no new questions and no commentary. " +
        "Reply with the rewritten question only, as plain text.",
      messages: [
        {
          role: "user",
          content: `CONVERSATION SO FAR:\n${transcript.slice(-16_000)}\n\nLATEST MESSAGE:\n${latestText}\n\nRewritten standalone question:`,
        },
      ],
    });
    const out = (text ?? "").trim().replace(/^["']|["']$/g, "");
    if (out && out.length <= 2000) return out;
  } catch (e) {
    console.warn("[chat resolveSearchQuery] failed", e);
  }
  return latestText;
}


function tryParseJson<T = any>(raw: string): T | null {
  const t = (raw ?? "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : t;
  try {
    return JSON.parse(body) as T;
  } catch {
    const m = body.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    return null;
  }
}


/**
 * Decide how to handle the latest user message given the thread's enabled
 * capabilities. Returns one of: "chat" (normal conversation), "web" (web
 * search), or "plan" (an action that should become an auto-running plan).
 */
async function classifyRoute(
  model: any,
  latestText: string,
  recent: string,
  caps: ChatCapabilities,
  memoryDigest = "",
): Promise<ChatRoute> {
  const actionEnabled = ACTION_GROUPS.some((g) => caps[g]);
  // Nothing actionable and no web search → always chat.
  if (!actionEnabled && !caps.web_search) return "chat";

  const enabled: string[] = [];
  if (caps.web_search) enabled.push("web_search (look up current/factual info online)");
  if (caps.document_editing) enabled.push("document_editing (create/rename docs, add/edit/move/mark sentences)");
  if (caps.image_generation) enabled.push("image_generation (create/edit/remix images to the gallery)");
  if (caps.video_generation) enabled.push("video_generation (make videos to the gallery)");
  if (caps.planning) enabled.push("planning (multi-step tasks combining the above)");

  const system =
    "You are the strict intent router for Orby, a writing assistant. Decide how to handle the user's latest message. " +
    "Return STRICT JSON only: {\"route\":\"chat\"|\"web\"|\"plan\"}.\n\n" +
    (actionEnabled
      ? "IMPORTANT CONTEXT: the user JUST deliberately switched ON action capabilities for THIS message only (these checkboxes are one-shot and clear after every send). That is a strong signal of intent to have Orby DO the work now, continuing whatever the conversation has been about. Default to \"plan\" unless the message is plainly just a question or comment seeking a text answer (\"what do you think\", \"how does this work\", \"which one is better\").\n" +
        "Short follow-ups like \"ok do it\", \"go ahead\", \"make those\", \"yes\", \"start\" ARE \"plan\" here — the work is whatever the recent conversation just agreed on.\n\n"
      : "DEFAULT TO \"chat\". Only escalate to \"web\" or \"plan\" when the user's intent is unmistakable.\n\n") +
    "Routes:\n" +
    "- chat: normal conversation, questions, explanations, brainstorming, opinions, and writing help — including reading, summarizing, analyzing, or answering questions ABOUT attached documents.\n" +
    (caps.web_search
      ? "- web: the user explicitly wants current, real-world, or factual info that requires looking it up online (news, prices, live facts, 'search for', 'look up', 'what's the latest').\n"
      : "") +
    (actionEnabled
      ? "- plan: Orby should DO something in the user's workspace — edit/organize/create documents, generate images or videos, schedule work — either because the message says so or because the conversation has been building toward it and the user has now enabled those capabilities.\n"
      : "") +
    "\nCRITICAL RULES:\n" +
    (actionEnabled
      ? "1. The user turning these capabilities on for this single message IS intent. Prefer \"plan\" whenever an actionable reading of the message (in light of the conversation) is reasonable.\n"
      : "1. A capability being ENABLED is only permission — it is NOT intent. Never choose \"plan\" or \"web\" just because a toggle is on.\n") +
    (actionEnabled
      ? "2. Only choose \"chat\" if the message clearly asks for a text answer and does not ask for any change or creation.\n"
      : "2. Discussing, asking about, quoting, or wanting a text response about an attached document is ALWAYS \"chat\", never \"plan\". Only choose \"plan\" if the user commands a CHANGE to the document or asks to create media.\n") +
    (actionEnabled
      ? "3. If you are unsure, choose \"plan\".\n"
      : "3. If you are unsure, or the message is a question/statement without a clear command, choose \"chat\".\n") +
    "4. Follow-ups matter: if a previous plan already ran in this conversation and the user now says something like \"keep going\", \"now add X to it\", \"do the same for the other doc\", that is a NEW \"plan\" (when planning-type capabilities are enabled) — the target is whatever that earlier plan produced. But merely ASKING about what a previous plan did is still \"chat\".\n" +
    (memoryDigest ? `\nPlan history in this conversation: ${memoryDigest}\n` : "") +
    `Only these capabilities are ENABLED: ${enabled.join("; ") || "none"}. ` +
    "Never choose a route whose capability is disabled — fall back to chat instead.";


  try {
    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: [
        {
          role: "user",
          content:
            (recent ? `Recent conversation:\n${recent}\n\n` : "") +
            `Latest message: "${latestText}"\n\nReturn JSON.`,
        },
      ],
    });
    const parsed = tryParseJson<{ route?: string }>(text);
    let route = (parsed?.route ?? "chat") as ChatRoute;
    if (route === "web" && !caps.web_search) route = "chat";
    if (route === "plan" && !actionEnabled) route = "chat";
    if (route !== "chat" && route !== "web" && route !== "plan") route = "chat";
    return route;
  } catch (e) {
    console.warn("[chat classifyRoute] failed", e);
    return "chat";
  }
}

/**
 * Run one chat turn. Classifies the latest message using the enabled
 * capabilities and either answers directly (conversation, web search, image
 * analysis) or reports that the request should become an auto-running plan.
 */
export async function runChatTurn(
  supabase: any,
  data: ChatTurnInput,
): Promise<{ route: ChatRoute; text?: string }> {
  
  const caps = data.capabilities;
  const contextText = await buildContext(supabase, data.contextDocumentIds);

  const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
  const latestText = lastUser?.content ?? data.messages[data.messages.length - 1].content;

  // Queen Bee resume path: if this thread has a plan awaiting a user reply,
  // treat this message as the answer, resume the plan in the background, and
  // stay silent in the chat (the plan itself will post follow-ups).
  if (data.threadId) {
    const { data: pending } = await supabase
      .from("plans")
      .select("id, steps, current_step")
      .eq("thread_id", data.threadId)
      .eq("status", "awaiting_user")
      .order("awaiting_since", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending?.id) {
      const steps: any[] = Array.isArray(pending.steps) ? pending.steps : [];
      const idx: number = pending.current_step ?? 0;
      const step = steps[idx];
      if (step && step.status === "awaiting_user") {
        step.status = "completed";
        step.result = { ...(step.result ?? {}), answer: latestText };
        step.error = null;
        const nextIdx = idx + 1;
        const updates: any = { steps, current_step: nextIdx, status: "running", step_claim_at: null };
        if (nextIdx >= steps.length) {
          updates.status = "completed";
          updates.completed_at = new Date().toISOString();
        }
        await supabase.from("plans").update(updates).eq("id", pending.id);
        return { route: "resumed" };
      }
    }
  }

  // Plan memory — everything this thread's earlier plans actually produced.
  // This is what lets the conversation keep going after a plan finishes.
  let memory = { block: "", digest: "", documentIds: [] as string[] };
  try {
    memory = await buildPlanMemory(supabase, data.threadId, {
      inlineDocs: true,
      excludeDocIds: data.contextDocumentIds,
    });
  } catch (e) {
    console.warn("[chat planMemory] failed", e);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const provider = createOpenAiProvider(apiKey);
  const model = provider("gpt-5.6-sol");

  const system =
    ORBY_BASE_RULES +
    " Reply in PLAIN TEXT ONLY. Never use markdown: no asterisks, no underscores, no backticks, no '#' headings, no bullet points or dashes as list markers. " +
    "You may use numbered lists (1. 2. 3.) when a list genuinely helps, separate paragraphs with a blank line, always use normal punctuation, and emojis are welcome. " +
    "You can kick off plans that edit documents and generate media, and you always come back to this " +
    "conversation afterwards.\n\n" +
    (contextText ? `${DOC_RULES} Their full content is appended to the end of the user's latest message.\n\n` : "") +
    (memory.block ? `${memory.block}\n\n` : "");


  // Attach documents LAST — after whatever the user typed. The block is
  // appended to the end of the latest user message so the model reads the
  // question first, then the full, freshly-pulled reference documents.
  const docBlock = contextText
    ? `\n\n[Attached documents — authoritative reference]\n${contextText}`
    : "";
  const latestWithDocs = `${latestText}${docBlock}`;

  // Vision route — attach every image to the latest user message (gated by capability).
  const images = Array.from(
    new Set([...(data.imageUrls ?? []), ...(data.imageUrl ? [data.imageUrl] : [])]),
  ).slice(0, 6);
  if (caps.image_analysis && images.length) {
    const history = data.messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const { text } = await aiSdkGenerateText({
      model,
      system,
      messages: [
        ...history,
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                latestWithDocs ||
                (images.length > 1 ? "Describe these images." : "Describe this image."),
            },
            ...images.map((url) => ({ type: "image", image: url })),
          ],
        },
      ] as any,
    });
    const out = toPlainText(text);
    if (!out) throw new Error("AI returned an empty response");
    return { route: "chat", text: out };

  }

  // Decide route with the thread's capabilities. A wider window so a mid-
  // conversation "ok do it" can be understood from what came before.
  const recent = data.messages
    .slice(-12)
    .map((m) => (m.role === "user" ? "User: " : "Orby: ") + m.content.slice(0, 2000))
    .join("\n");
  let route = await classifyRoute(model, latestText, recent, caps, memory.digest);

  // Attached-documents safety net: when the user has documents attached but
  // did NOT switch on any action capability for this message, only let the
  // request become a plan if they clearly asked to CHANGE something. When the
  // user did tick an action capability, that IS the intent — never override it.
  const actionCapsOn = ACTION_GROUPS.some((g) => caps[g]);
  if (route === "plan" && contextText && !actionCapsOn) {
    const wantsAction =
      /\b(edit|rewrite|revise|update|change|add|append|insert|delete|remove|replace|organi[sz]e|reorder|move|rename|create|generate|make|produce|draw|render|remix|summari[sz]e into|turn (this|it) into|convert)\b/i.test(
        latestText,
      );
    if (!wantsAction) route = "chat";
  }


  if (route === "plan") {
    // The client creates and auto-runs the plan; nothing to answer here.
    return { route: "plan" };
  }

  if (route === "web") {
    // Resolve short follow-ups against the thread, then search with the whole
    // conversation as context. Attached documents ride along as reference.
    const standalone = await resolveSearchQuery(model, latestText, recent);
    const query = `${standalone}${docBlock}`;
    const { ok, text } = await runWebSearch(query, recent);
    if (!ok) throw new Error(text);
    return { route: "chat", text: toPlainText(text) };
  }


  // Normal chat route — append the documents to the final user message so
  // they come after the user's text, and rebuild fresh on every send.
  const outgoing = data.messages.map((m) => ({ role: m.role, content: m.content }));
  if (docBlock) {
    for (let i = outgoing.length - 1; i >= 0; i--) {
      if (outgoing[i].role === "user") {
        outgoing[i] = { ...outgoing[i], content: `${outgoing[i].content}${docBlock}` };
        break;
      }
    }
  }
  const { text } = await aiSdkGenerateText({
    model,
    system,
    messages: outgoing,
  });
  const out = toPlainText(text);
  if (!out) throw new Error("AI returned an empty response");
  return { route: "chat", text: out };
}
