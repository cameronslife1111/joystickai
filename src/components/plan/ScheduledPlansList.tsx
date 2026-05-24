import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import {
  listSchedules,
  deleteSchedule,
  toggleSchedule,
  runScheduleNow,
} from "@/lib/plan-schedules.functions";
import { ScheduleEditorDialog } from "./ScheduleEditorDialog";
import { Pencil, Trash2, PlayCircle, Plus } from "lucide-react";

const CADENCE_LABEL: Record<string, string> = {
  once: "Once",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function describeSchedule(s: any): string {
  const tod = s.time_of_day ? ` at ${s.time_of_day}` : "";
  switch (s.cadence) {
    case "once":
      return s.starts_at ? `Once on ${new Date(s.starts_at).toLocaleString()}` : "Once";
    case "hourly":
      return s.interval_n > 1 ? `Every ${s.interval_n} hours` : "Hourly";
    case "daily":
      return s.interval_n > 1 ? `Every ${s.interval_n} days${tod}` : `Daily${tod}`;
    case "weekly": {
      const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const days = (s.weekdays ?? []).map((d: number) => wd[d]).join(", ") || "weekly";
      return `Weekly on ${days}${tod}`;
    }
    case "monthly": {
      const days = (s.month_days ?? []).slice().sort((a: number, b: number) => a - b).join(", ");
      return `Monthly on day ${days || "1"}${tod}`;
    }
    case "yearly": {
      const entries = (s.year_month_days ?? []).map((e: any) => `${e.month}/${e.day}`).join(", ");
      return `Yearly on ${entries || "1/1"}${tod}`;
    }
    default:
      return CADENCE_LABEL[s.cadence] ?? s.cadence;
  }
}

export function ScheduledPlansList() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSchedules);
  const deleteFn = useServerFn(deleteSchedule);
  const toggleFn = useServerFn(toggleSchedule);
  const runFn = useServerFn(runScheduleNow);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data, refetch } = useQuery({
    queryKey: ["plan_schedules"],
    refetchInterval: 15000,
    queryFn: async () => await listFn({}),
  });

  const schedules = useMemo(() => data?.schedules ?? [], [data]);

  const onToggle = async (s: any, v: boolean) => {
    try {
      await toggleFn({ data: { id: s.id, enabled: v } });
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update");
    }
  };

  const onDelete = async (s: any) => {
    if (!confirm(`Delete schedule "${s.title}"?`)) return;
    try {
      await deleteFn({ data: { id: s.id } });
      toast.success("Schedule deleted");
      refetch();
      qc.invalidateQueries({ queryKey: ["plans"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't delete");
    }
  };

  const onRunNow = async (s: any) => {
    try {
      await runFn({ data: { id: s.id } });
      toast.success("Started — see Active.");
      qc.invalidateQueries({ queryKey: ["plans"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't run");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Scheduled ({schedules.length})
        </h2>
        <button
          onClick={() => { setEditing(null); setEditorOpen(true); }}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> New schedule
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No schedules yet. Tap "New schedule" to set one up.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s: any) => (
            <li
              key={s.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.title || "Untitled"}</span>
                    {!s.enabled && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">paused</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {describeSchedule(s)}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {s.next_run_at
                      ? `Next: ${new Date(s.next_run_at).toLocaleString()}`
                      : "No more runs"}
                    {typeof s.run_count === "number" && s.run_count > 0
                      ? ` · ${s.run_count} run${s.run_count === 1 ? "" : "s"}`
                      : ""}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs">{s.user_request}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Switch checked={!!s.enabled} onCheckedChange={(v) => onToggle(s, v)} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => onRunNow(s)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted/40"
                >
                  <PlayCircle className="h-3.5 w-3.5" /> Run now
                </button>
                <button
                  onClick={() => { setEditing(s); setEditorOpen(true); }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted/40"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => onDelete(s)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ScheduleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        onSaved={() => refetch()}
      />
    </div>
  );
}
