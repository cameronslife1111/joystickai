import { supabase } from "@/integrations/supabase/client";
import {
  normalizeCapabilities,
  type ChatCapabilities,
  type ChatRoute,
} from "@/lib/chat-types";

/** Action capabilities that map onto plan tool groups (mirrors ChatDialog). */
const ACTION_TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
  "web_search",
];

export const CHAT_DEFAULT_CAPS: ChatCapabilities = {
  web_search: true,
  image_analysis: true,
  planning: true,
  image_generation: true,
  video_generation: true,
  document_editing: true,
  scheduling: true,
};

type SendChatFn = (args: {
  data: {
    messages: { role: "user" | "assistant"; content: string }[];
    contextDocumentIds: string[];
    imageUrls: string[];
    threadId: string;
    capabilities: ChatCapabilities;
  };
}) => Promise<{ route: ChatRoute; text?: string }>;

type NameThreadFn = (args: { data: { message: string } }) => Promise<{ title: string }>;

/**
 * Headless version of ChatDialog's send pipeline: writes the user message into
 * a thread, runs the chat turn, and persists whatever comes back (plain reply,
 * or a plan that auto-runs). Used by the New idea composer so text can be sent
 * into a chat without ever opening the chat window.
 */
export async function sendTextToChatThread(opts: {
  userId: string;
  threadId: string;
  text: string;
  send: SendChatFn;
}): Promise<void> {
  const { userId, threadId, text, send } = opts;

  const { data: thread, error: threadErr } = await supabase
    .from("chat_threads")
    .select("id, capabilities, attached_document_ids")
    .eq("id", threadId)
    .maybeSingle();
  if (threadErr) throw threadErr;
  if (!thread) throw new Error("Chat not found");

  const caps = normalizeCapabilities(thread.capabilities, CHAT_DEFAULT_CAPS);
  const docIds = (thread.attached_document_ids ?? []) as string[];

  const { data: priorRows, error: histErr } = await supabase
    .from("chat_messages")
    .select("role, content, kind")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (histErr) throw histErr;

  const { data: insertedUser, error: userErr } = await supabase
    .from("chat_messages")
    .insert({ user_id: userId, thread_id: threadId, role: "user", content: text, kind: "text" })
    .select("id")
    .single();
  if (userErr || !insertedUser) throw userErr ?? new Error("Couldn't save the message");

  const history = [
    ...((priorRows ?? []) as { role: string; content: string | null; kind: string | null }[]),
    { role: "user", content: text, kind: "text" },
  ]
    .map((m) =>
      m.kind === "plan"
        ? {
            role: "assistant" as const,
            content: "[A plan was kicked off here and ran in the background.]",
          }
        : { role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: m.content ?? "" },
    )
    .filter((m) => m.content.trim().length > 0);

  const result = await send({
    data: {
      messages: history,
      contextDocumentIds: docIds,
      imageUrls: [],
      threadId,
      capabilities: caps,
    },
  });

  if (result.route === "plan") {
    const allowedGroups = ACTION_TOOL_GROUPS.filter((g) => caps[g]);
    const { data: planRow, error: planErr } = await supabase
      .from("plans")
      .insert({
        user_id: userId,
        status: "composing",
        user_request: text,
        attached_document_ids: docIds,
        thread_id: threadId,
      })
      .select("id")
      .single();
    if (planErr || !planRow) throw new Error(planErr?.message || "Couldn't start the plan");
    void supabase.functions.invoke("plan-compose", {
      body: { plan_id: planRow.id, allowed_tool_groups: allowedGroups },
    });
    const { error: aErr } = await supabase.from("chat_messages").insert({
      user_id: userId,
      thread_id: threadId,
      role: "assistant",
      content: "On it — planning and running this now.",
      kind: "plan",
      plan_id: planRow.id,
    });
    if (aErr) throw aErr;
  } else if (result.route !== "resumed") {
    const { error: aErr } = await supabase.from("chat_messages").insert({
      user_id: userId,
      thread_id: threadId,
      role: "assistant",
      content: result.text ?? "",
      kind: "text",
    });
    if (aErr) throw aErr;
  }

  await supabase
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);
}

/** Creates a fresh chat thread with all capabilities available. */
export async function createChatThread(
  userId: string,
  title = "New chat",
): Promise<{ id: string; title: string }> {
  const { data, error } = await supabase
    .from("chat_threads")
    .insert({ user_id: userId, title, capabilities: CHAT_DEFAULT_CAPS })
    .select("id, title")
    .single();
  if (error || !data) throw new Error(error?.message || "Couldn't create the chat");
  return { id: data.id, title: data.title };
}

export type { NameThreadFn };
