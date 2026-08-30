// Server-only chat core. Shared by the authenticated chat server function and
// the background scheduler (which fires scheduled chat messages with the admin
// client on behalf of a user). Never import this from client code.
import { generateText as aiSdkGenerateText } from "ai";
import { createOpenAiProvider } from "./ai-gateway";
import { buildPlanMemory } from "./plan-memory";
import { toPlainText } from "./plain-text";
import { DOC_RULES, ORBY_BASE_RULES } from "./assistant-instructions";

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
 * Decide how to handle the latest user message AND which capabilities the work
 * would need. Orby decides for itself: capabilities the user ticked are always
 * kept, and Orby may switch on more when a step needs them. It never removes a
 * capability the user asked for.
 */
async function classifyTurn(
  model: any,
  latestText: string,
  recent: string,
  caps: ChatCapabilities,
  memoryDigest = "",
  auto = false,
): Promise<{ route: ChatRoute; capabilities: ChatCapabilities; rationale: string }> {
  const userOn = ACTION_GROUPS.filter((g) => caps[g]);
  // Manual mode: the user's checkboxes decide what is even possible.
  const planAllowed = auto || userOn.length > 0;
  const webAllowed = auto || caps.web_search;

  const system =
    "You are the intent router for Orby, an assistant that works inside the user's documents and media gallery. " +
    "Decide how to handle the user's latest message, and decide which of your capabilities the work would need.\n\n" +
    "Return STRICT JSON only:\n" +
    '{"route":"chat"|"web"|"plan","capabilities":["planning","document_editing","image_generation","video_generation","scheduling","web_search"],"rationale":"one plain-text sentence"}\n\n' +
    "Routes:\n" +
    "- chat: conversation, questions, explanations, opinions, brainstorming, and anything that only needs a text answer — including reading, summarizing, or analyzing attached documents.\n" +
    "- web: the user wants current, real-world or factual information that requires looking it up online right now (news, prices, live facts, 'look up', \"what's the latest\").\n" +
    "- plan: Orby should DO something in the user's workspace — create/rename/edit documents, add/move/delete sentences, generate or edit images, make videos, or schedule work for later.\n\n" +
    "CRITICAL RULES:\n" +
    (auto
      ? "1. You decide on your own. Do NOT require the user to have enabled anything — if the message asks for work, choose \"plan\".\n"
      : `1. Only these routes are available for this message: ${["chat", webAllowed ? "web" : null, planAllowed ? "plan" : null].filter(Boolean).join(", ")}. Never return a route outside that list — when the work you'd want is unavailable, answer as "chat".\n`) +
    "2. Only choose \"chat\" when the message plainly wants a text answer and asks for no change or creation.\n" +
    "3. Follow-ups matter: after a plan has run, \"keep going\", \"now add X\", \"do the same for the other doc\" are a NEW \"plan\". Merely ASKING about what a plan did is \"chat\".\n" +
    "4. Short confirmations (\"ok do it\", \"go ahead\", \"yes\", \"start\") are \"plan\" when the conversation just agreed on work to do.\n" +
    "5. capabilities: list every capability the work genuinely needs, and nothing else. For \"plan\", always include \"planning\" when there is more than one step. For \"chat\" return an empty list. For \"web\" return [\"web_search\"].\n" +
    "6. rationale: one short plain-text sentence naming the task you detected. No markdown.\n" +
    (userOn.length
      ? `The user explicitly switched these on for this message, so they are definitely wanted: ${userOn.join(", ")}.\n`
      : "") +
    (memoryDigest ? `\nPlan history in this conversation: ${memoryDigest}\n` : "");

  const KNOWN = [
    "planning",
    "document_editing",
    "image_generation",
    "video_generation",
    "scheduling",
    "web_search",
  ] as const;

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
    const parsed = tryParseJson<{ route?: string; capabilities?: unknown; rationale?: unknown }>(text);
    let route = (parsed?.route ?? "chat") as ChatRoute;
    if (route !== "chat" && route !== "web" && route !== "plan") route = "chat";

    const wanted = new Set(
      (Array.isArray(parsed?.capabilities) ? parsed!.capabilities : [])
        .filter((c: unknown): c is string => typeof c === "string")
        .map((c) => c.trim().toLowerCase())
        .filter((c) => (KNOWN as readonly string[]).includes(c)),
    );

    // Auto mode (Delegate): union — never drop a capability the user ticked,
    // and let Orby switch more on. Manual mode: exactly what the user ticked.
    const merged: ChatCapabilities = auto
      ? {
          ...caps,
          web_search: caps.web_search || wanted.has("web_search"),
          planning: caps.planning || wanted.has("planning"),
          document_editing: caps.document_editing || wanted.has("document_editing"),
          image_generation: caps.image_generation || wanted.has("image_generation"),
          video_generation: caps.video_generation || wanted.has("video_generation"),
          scheduling: caps.scheduling || wanted.has("scheduling"),
        }
      : { ...caps };

    // Manual mode: the checkboxes are the gate — clamp routes the user didn't
    // switch on back to a plain text answer.
    if (!auto) {
      if (route === "plan" && !planAllowed) route = "chat";
      if (route === "web" && !webAllowed) route = "chat";
    }

    // A plan needs at least one action capability to be runnable at all.
    if (auto && route === "plan" && !ACTION_GROUPS.some((g) => merged[g])) {
      merged.planning = true;
      merged.document_editing = true;
    }


    const rationale = typeof parsed?.rationale === "string" ? parsed.rationale.trim().slice(0, 400) : "";
    return { route, capabilities: merged, rationale };
  } catch (e) {
    console.warn("[chat classifyTurn] failed", e);
    return { route: "chat", capabilities: caps, rationale: "" };
  }
}

/**
 * Run one chat turn. Orby classifies the latest message itself and either
 * answers directly (conversation, web search, image analysis) or reports that
 * the request should become a plan — along with the capabilities that plan
 * needs, so the user never has to toggle them.
 */
export async function runChatTurn(
  supabase: any,
  data: ChatTurnInput,
): Promise<{
  route: ChatRoute;
  text?: string;
  capabilities?: ChatCapabilities;
  rationale?: string;
}> {
  
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
    "MEDIA IN THE CHAT: images, videos and audio you or the user reference appear inline in this chat. " +
    "When you mention one, write its title in double quotes exactly as listed — that is what makes it show up. " +
    "When the user asks to change something about a media item that already exists (\"make the sky more orange\", " +
    "\"same image but at night\"), that is a NEW plan that edits or regenerates that exact asset by id — never treat it as chit-chat.\n\n" +
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
  const decision = await classifyTurn(
    model,
    latestText,
    recent,
    caps,
    memory.digest,
    data.autoCapabilities === true,
  );
  const route = decision.route;

  if (route === "plan") {
    // The client creates the plan and shows it for review in the chat.
    return {
      route: "plan",
      capabilities: decision.capabilities,
      rationale: decision.rationale,
    };
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
