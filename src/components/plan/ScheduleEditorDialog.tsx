import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sortDocsByTitle } from "@/lib/sortDocs";
import { useServerFn } from "@tanstack/react-start";
import {
  createSchedule,
  updateSchedule,
  previewNextRuns,
} from "@/lib/plan-schedules.functions";
import { detectTimezone, type Cadence } from "@/lib/recurrence";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, the dialog edits this existing schedule row. */
  initial?: any | null;
  /** Defaults used when creating a brand new schedule from the composer. */
  defaults?: {
    user_request?: string;
    attached_document_ids?: string[];
    title?: string;
  } | null;
  onSaved?: (scheduleId: string) => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CADENCES: { value: Cadence; label: string; helper: string }[] = [
  { value: "once", label: "Once", helper: "Fires a single time at the chosen date & time." },
  { value: "hourly", label: "Hourly", helper: "Every N hours, starting at the chosen time." },
  { value: "daily", label: "Daily", helper: "Every N days at the chosen time of day." },
  { value: "weekly", label: "Weekly", helper: "On the days you pick, at the chosen time." },
  { value: "monthly", label: "Monthly", helper: "On the days of the month you pick." },
  { value: "yearly", label: "Yearly", helper: "On the months/days you pick each year." },
];

function nowLocalDatetimeValue(): string {
  // value for <input type="datetime-local">; user-local clock, no TZ suffix.
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}
function datetimeLocalToISO(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function ScheduleEditorDialog({ open, onOpenChange, initial, defaults, onSaved }: Props) {
  const qc = useQueryClient();
  const createFn = useServerFn(createSchedule);
  const updateFn = useServerFn(updateSchedule);
  const previewFn = useServerFn(previewNextRuns);

  const editing = !!initial?.id;

  const [title, setTitle] = useState("");
  const [userRequest, setUserRequest] = useState("");
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [intervalN, setIntervalN] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [timezone, setTimezone] = useState<string>(detectTimezone());
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthDays, setMonthDays] = useState<number[]>([1]);
  const [yearMonthDays, setYearMonthDays] = useState<{ month: number; day: number }[]>([{ month: 1, day: 1 }]);
  const [startsAtLocal, setStartsAtLocal] = useState<string>(nowLocalDatetimeValue());
  const [endsAtLocal, setEndsAtLocal] = useState<string>("");
  const [maxRuns, setMaxRuns] = useState<string>("");
  const [enabled, setEnabled] = useState(true);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewRuns, setPreviewRuns] = useState<string[]>([]);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  // Reset whenever opened.
  useEffect(() => {
    if (!open) return;
    if (editing && initial) {
      setTitle(initial.title ?? "Untitled schedule");
      setUserRequest(initial.user_request ?? "");
      setAttachedIds(initial.attached_document_ids ?? []);
      setCadence((initial.cadence as Cadence) ?? "daily");
      setIntervalN(initial.interval_n ?? 1);
      setTimeOfDay(initial.time_of_day ?? "09:00");
      setTimezone(initial.timezone ?? detectTimezone());
      setWeekdays(initial.weekdays ?? [1]);
      setMonthDays(initial.month_days ?? [1]);
      setYearMonthDays(initial.year_month_days ?? [{ month: 1, day: 1 }]);
      setStartsAtLocal(isoToDatetimeLocal(initial.starts_at) || nowLocalDatetimeValue());
      setEndsAtLocal(isoToDatetimeLocal(initial.ends_at));
      setMaxRuns(initial.max_runs ? String(initial.max_runs) : "");
      setEnabled(initial.enabled ?? true);
    } else {
      const defaultTitle =
        defaults?.title ??
        (defaults?.user_request ? defaults.user_request.slice(0, 60) : "Untitled schedule");
      setTitle(defaultTitle);
      setUserRequest(defaults?.user_request ?? "");
      setAttachedIds(defaults?.attached_document_ids ?? []);
      setCadence("daily");
      setIntervalN(1);
      setTimeOfDay("09:00");
      setTimezone(detectTimezone());
      setWeekdays([new Date().getDay()]);
      setMonthDays([new Date().getDate()]);
      setYearMonthDays([{ month: new Date().getMonth() + 1, day: new Date().getDate() }]);
      setStartsAtLocal(nowLocalDatetimeValue());
      setEndsAtLocal("");
      setMaxRuns("");
      setEnabled(true);
    }
    setDocPickerOpen(false);
    setDocSearch("");
    setPreviewRuns([]);
    setPreviewErr(null);
  }, [open, editing, initial, defaults]);

  const { data: docs = [] } = useQuery({
    queryKey: ["schedule_editor_docs"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("documents").select("id, title").order("updated_at", { ascending: false });
      return sortDocsByTitle((data ?? []).map((d) => ({ id: d.id, title: d.title ?? "Untitled" })));
    },
  });
  const titleById = useMemo(() => new Map(docs.map((d) => [d.id, d.title] as const)), [docs]);
  const filteredDocs = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    return q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  }, [docs, docSearch]);

  // Live preview (debounced).
  const previewInput = useMemo(
    () => ({
      title,
      user_request: userRequest || "(scheduled plan)",
      attached_document_ids: attachedIds,
      cadence,
      interval_n: intervalN,
      time_of_day: ["once", "hourly"].includes(cadence) ? null : timeOfDay,
      timezone,
      weekdays,
      month_days: monthDays,
      year_month_days: yearMonthDays,
      starts_at: datetimeLocalToISO(startsAtLocal),
      ends_at: endsAtLocal ? datetimeLocalToISO(endsAtLocal) : null,
      max_runs: maxRuns ? Number(maxRuns) : null,
    }),
    [
      title, userRequest, attachedIds, cadence, intervalN, timeOfDay, timezone,
      weekdays, monthDays, yearMonthDays, startsAtLocal, endsAtLocal, maxRuns,
    ],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        setPreviewErr(null);
        const res = await previewFn({ data: previewInput as any });
        if (!cancelled) setPreviewRuns(res.runs ?? []);
      } catch (e: any) {
        if (!cancelled) {
          setPreviewRuns([]);
          setPreviewErr(e?.message ?? "Could not compute next runs.");
        }
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [open, previewInput, previewFn]);

  const toggleWeekday = (d: number) =>
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  const toggleMonthDay = (d: number) =>
    setMonthDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  const toggleAttach = (id: string) =>
    setAttachedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 10 ? cur : [...cur, id],
    );

  const save = async () => {
    if (!userRequest.trim() && attachedIds.length === 0) {
      toast.error("Add a request or attach at least one document.");
      return;
    }
    if (!title.trim()) {
      toast.error("Give your schedule a title.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const res = await updateFn({
          data: {
            id: initial.id,
            patch: { ...(previewInput as any), enabled },
          },
        });
        toast.success("Schedule updated");
        onSaved?.(res.schedule.id);
      } else {
        const res = await createFn({ data: { ...(previewInput as any), enabled } });
        toast.success("Schedule created");
        onSaved?.(res.schedule.id);
      }
      qc.invalidateQueries({ queryKey: ["plan_schedules"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save schedule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg h-[88svh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 border-b border-border px-4 pt-5 pb-3 sm:px-6">
          <DialogTitle>{editing ? "Edit schedule" : "Schedule a plan"}</DialogTitle>
          <DialogDescription className="min-w-0 break-words">
            Orby will run this plan automatically on the cadence you pick. Plans never run within 30 minutes of each other.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-6 sm:py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          {/* Request */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">What should Orby do?</label>
            <Textarea
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              rows={3}
              placeholder="e.g. Summarize today's news into my Daily Brief doc."
            />
          </div>

          {/* Attached docs */}
          <div className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setDocPickerOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
            >
              <span className="truncate">
                {attachedIds.length > 0
                  ? `Attached documents (${attachedIds.length}/10)`
                  : "+ Attach documents (optional)"}
              </span>
              <span className="shrink-0 text-muted-foreground">{docPickerOpen ? "▴" : "▾"}</span>
            </button>
            {attachedIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2">
                {attachedIds.map((id) => (
                  <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs">
                    <span className="min-w-0 max-w-[12rem] truncate">{titleById.get(id) ?? "Untitled"}</span>
                    <button type="button" onClick={() => toggleAttach(id)} className="shrink-0 text-muted-foreground hover:text-foreground">×</button>
                  </span>
                ))}
              </div>
            )}
            {docPickerOpen && (
              <div className="border-t border-border p-2 space-y-2">
                <Input value={docSearch} onChange={(e) => setDocSearch(e.target.value)} placeholder="Search documents…" className="h-8 text-sm" />
                <div className="max-h-44 overflow-y-auto rounded-md border border-border/50 bg-background/40">
                  <ul>
                    {filteredDocs.map((d) => {
                      const checked = attachedIds.includes(d.id);
                      return (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => toggleAttach(d.id)}
                            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                          >
                            <Checkbox checked={checked} />
                            <span className="min-w-0 flex-1 truncate">{d.title || "Untitled"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Cadence */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Repeats</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CADENCES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCadence(c.value)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    cadence === c.value
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {CADENCES.find((c) => c.value === cadence)?.helper}
            </p>
          </div>

          {/* Cadence-specific options */}
          {cadence === "once" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Run at</label>
              <Input type="datetime-local" value={startsAtLocal} onChange={(e) => setStartsAtLocal(e.target.value)} />
            </div>
          )}

          {cadence === "hourly" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Every (hours)</label>
                <Input type="number" min={1} max={168} value={intervalN} onChange={(e) => setIntervalN(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Starting</label>
                <Input type="datetime-local" value={startsAtLocal} onChange={(e) => setStartsAtLocal(e.target.value)} />
              </div>
            </div>
          )}

          {(cadence === "daily" || cadence === "weekly" || cadence === "monthly" || cadence === "yearly") && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Time of day</label>
                <Input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
              </div>
              {cadence === "daily" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Every (days)</label>
                  <Input type="number" min={1} max={365} value={intervalN} onChange={(e) => setIntervalN(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              )}
            </div>
          )}

          {cadence === "weekly" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">On these days</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, idx) => {
                  const on = weekdays.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleWeekday(idx)}
                      className={`rounded-md border px-2.5 py-1 text-xs ${
                        on ? "border-primary bg-primary/15" : "border-border text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {cadence === "monthly" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Days of the month</label>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                  const on = monthDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleMonthDay(d)}
                      className={`h-7 w-7 rounded-md border text-[11px] ${
                        on ? "border-primary bg-primary/15" : "border-border text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                If a month has fewer days, the last day is used instead.
              </p>
            </div>
          )}

          {cadence === "yearly" && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Yearly dates</label>
              {yearMonthDays.map((ymd, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="number" min={1} max={12} value={ymd.month}
                    onChange={(e) => {
                      const v = Math.min(12, Math.max(1, Number(e.target.value) || 1));
                      setYearMonthDays((cur) => cur.map((x, idx) => (idx === i ? { ...x, month: v } : x)));
                    }}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">/</span>
                  <Input
                    type="number" min={1} max={31} value={ymd.day}
                    onChange={(e) => {
                      const v = Math.min(31, Math.max(1, Number(e.target.value) || 1));
                      setYearMonthDays((cur) => cur.map((x, idx) => (idx === i ? { ...x, day: v } : x)));
                    }}
                    className="w-20"
                  />
                  <button
                    type="button"
                    onClick={() => setYearMonthDays((cur) => cur.filter((_, idx) => idx !== i))}
                    className="text-xs text-muted-foreground hover:text-destructive"
                    disabled={yearMonthDays.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setYearMonthDays((cur) => [...cur, { month: 1, day: 1 }])}
                className="text-xs text-primary hover:underline"
              >
                + Add date
              </button>
            </div>
          )}

          {/* Bounds */}
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Advanced (end date, max runs, timezone)</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Ends after</label>
                <Input type="datetime-local" value={endsAtLocal} onChange={(e) => setEndsAtLocal(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Max runs</label>
                <Input type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] text-muted-foreground">Timezone</label>
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              </div>
            </div>
          </details>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="text-sm">Active</div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Preview */}
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Next runs</div>
            {previewErr ? (
              <div className="text-xs text-destructive">{previewErr}</div>
            ) : previewRuns.length === 0 ? (
              <div className="text-xs text-muted-foreground">No upcoming runs.</div>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {previewRuns.map((iso) => (
                  <li key={iso}>{new Date(iso).toLocaleString()}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Runs that fall within 30 minutes of another scheduled plan will automatically slide forward.
            </p>
          </div>
        </div>

        <div
          className="shrink-0 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:px-6"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create schedule"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
