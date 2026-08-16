import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { DelegatePick, DelegateSuggestion } from "@/lib/delegate-prompt";

export type DelegateCardState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "choose";
      taskContext: string;
      suggestions: DelegateSuggestion[];
      checked: boolean[];
      notes: string[];
    }
  | { phase: "approved"; taskContext: string; picked: DelegatePick[] };

interface Props {
  state: DelegateCardState;
  onToggle: (i: number) => void;
  onNote: (i: number, value: string) => void;
  onApprove: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

export function DelegateSuggestionsCard({
  state,
  onToggle,
  onNote,
  onApprove,
  onCancel,
  onRetry,
}: Props) {
  return (
    <div className="w-full max-w-[95%] rounded-2xl border border-foreground/10 bg-chat-assistant p-3 text-chat-assistant-foreground">
      <div className="mb-2 text-sm font-medium">🟣 Delegate</div>

      {state.phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading your document and thinking of what I can do…
        </div>
      )}

      {state.phase === "error" && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}

      {state.phase === "choose" && (
        <div className="space-y-3">
          {state.taskContext && (
            <p className="text-sm text-muted-foreground">{state.taskContext}</p>
          )}
          <p className="text-sm">Pick what you want me to do, then press Approve.</p>
          <div className="space-y-2">
            {state.suggestions.map((s, i) => (
              <div key={i} className="rounded-xl border border-foreground/10 p-2">
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    checked={state.checked[i] ?? false}
                    onCheckedChange={() => onToggle(i)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{s.title}</span>
                    {s.detail ? (
                      <span className="block text-muted-foreground">{s.detail}</span>
                    ) : null}
                  </span>
                </label>
                {state.checked[i] && (
                  <Textarea
                    value={state.notes[i] ?? ""}
                    onChange={(e) => onNote(i, e.target.value)}
                    placeholder="Note (optional) — extra info, documents or media gallery images to reference, links, constraints…"
                    maxLength={2000}
                    className="mt-2 min-h-[64px] w-full resize-y text-sm"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!state.checked.some(Boolean)} onClick={onApprove}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state.phase === "approved" && (
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">Approved — building the plan for:</p>
          <ul className="list-none space-y-1">
            {state.picked.map((p, i) => (
              <li key={i}>
                {i + 1}. {p.suggestion.title}
                {p.note.trim() ? (
                  <span className="block text-muted-foreground">Note: {p.note.trim()}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
