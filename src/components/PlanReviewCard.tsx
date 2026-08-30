import { useState } from "react";
import { AlertCircle, Loader2, Send, Square, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/DictateButton";
import { supabase } from "@/integrations/supabase/client";
import type { ChatCapabilities } from "@/lib/chat-types";

const CAP_TEXT: Record<string, string> = {
  planning: "multi-step planning",
  document_editing: "document editing",
  image_generation: "image generation",
  video_generation: "video generation",
  scheduling: "scheduling",
  web_search: "web search",
};

const TOOL_GROUPS: (keyof ChatCapabilities)[] = [
  "document_editing",
  "image_generation",
  "video_generation",
  "scheduling",
  "web_search",
];

export type ReviewPlan = {
  id: string;
  plan_summary: string | null;
  user_request: string;
  steps: any[];
  proposed_capabilities: Record<string, boolean> | null;
};

/**
 * The plan Orby proposes inside a chat, before anything runs. The user reads
 * what Orby detected and which capabilities it wants, then approves, adds a
 * note (which triggers a full replan), or cancels.
 */
export function PlanReviewCard({ plan }: { plan: ReviewPlan }) {
  const [busy, setBusy] = useState<null | "approve" | "note" | "cancel">(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const caps = plan.proposed_capabilities ?? {};
  const capList = Object.keys(CAP_TEXT).filter((k) => caps[k]);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const allowedGroups = TOOL_GROUPS.filter((g) => caps[g]);

  const approve = async () => {
    setBusy("approve");
    const { error } = await supabase
      .from("plans")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (error) {
      setBusy(null);
      toast.error(`Couldn't start: ${error.message}`);
      return;
    }
    void supabase.functions.invoke("plan-step", { body: { plan_id: plan.id } });
    toast.success("Plan started — running in the background");
  };

  /**
   * Rewrite the plan with the user's note. `autoRun` = "approve with notes":
   * the rewritten plan starts by itself. Otherwise it comes back for review.
   */
  const sendNote = async (autoRun: boolean) => {
    const text = note.trim();
    if (!text) return;
    setBusy("note");
    const { error } = await supabase
      .from("plans")
      .update({
        status: "composing",
        user_request: `${plan.user_request}\n\nNOTE FROM ME: ${text}`,
        steps: null,
        current_step: 0,
        total_steps: 0,
        auto_approve_after_compose: autoRun,
      })
      .eq("id", plan.id);
    if (error) {
      setBusy(null);
      toast.error(`Couldn't send that note: ${error.message}`);
      return;
    }
    void supabase.functions.invoke("plan-compose", {
      body: { plan_id: plan.id, allowed_tool_groups: allowedGroups.length ? allowedGroups : null },
    });
    setNote("");
    setNoteOpen(false);
    toast.success(autoRun ? "Rewriting your plan, then running it" : "Rewriting your plan");
  };

  const cancel = async () => {
    setBusy("cancel");
    const { error } = await supabase.from("plans").update({ status: "cancelled" }).eq("id", plan.id);
    if (error) {
      setBusy(null);
      toast.error(`Couldn't cancel: ${error.message}`);
    }
  };

  if (steps.length === 0) {
    return (
      <div className="w-full max-w-[95%] rounded-xl border border-destructive/30 bg-card/50 p-3 text-sm">
        <div className="mb-1.5 flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4 text-destructive" /> Orby couldn&apos;t plan that
        </div>
        {plan.plan_summary && (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{plan.plan_summary}</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[95%] rounded-xl border border-primary/30 bg-card/60 p-3 text-sm">
      <div className="mb-1.5 font-medium">Here&apos;s my plan — review it</div>

      {plan.plan_summary && (
        <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">{plan.plan_summary}</p>
      )}

      {capList.length > 0 && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Capabilities I&apos;ll switch on: {capList.map((k) => CAP_TEXT[k]).join(", ")}
        </p>
      )}

      <ol className="mb-2 flex flex-col gap-1.5">
        {steps.map((s: any, i: number) => (
          <li key={i} className="text-xs leading-snug">
            <span className="mr-1 opacity-60">{i + 1}.</span>
            {s?.description ?? `Step ${i + 1}`}
          </li>
        ))}
      </ol>

      {noteOpen && (
        <div className="mb-2 flex flex-col gap-1.5">
          <div className="flex items-end gap-1">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any changes? e.g. don't use video, put the output in a new document…"
              rows={2}
              className="min-h-[52px] flex-1 text-sm"
            />
            <DictateButton onText={(t) => setNote((cur) => (cur ? `${cur} ${t}` : t))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1"
              disabled={!note.trim() || busy !== null}
              onClick={() => void sendNote(true)}
            >
              {busy === "note" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Approve with notes
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!note.trim() || busy !== null}
              onClick={() => void sendNote(false)}
            >
              Rewrite &amp; show me again
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy !== null} onClick={() => void approve()}>
          {busy === "approve" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          disabled={busy !== null}
          onClick={() => setNoteOpen((o) => !o)}
        >
          <StickyNote className="h-3.5 w-3.5" /> Add a note
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 text-muted-foreground"
          disabled={busy !== null}
          onClick={() => void cancel()}
        >
          <Square className="h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );
}

/** "Tell Orby what to do" box shown when a plan failed or was stopped. */
export function PlanSteerBox({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="mt-2 flex items-end gap-1">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell Orby what to do…"
        rows={2}
        className="min-h-[52px] flex-1 text-sm"
      />
      <DictateButton onText={(t) => setText((cur) => (cur ? `${cur} ${t}` : t))} />
      <Button
        size="icon"
        disabled={!text.trim()}
        onClick={() => {
          const t = text.trim();
          setText("");
          onSend(t);
        }}
        aria-label="Send to Orby"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
