interface StepIo {
  inputs?: string;
  inputSource?: string;
  operation?: string;
  output?: string;
  destination?: string;
  capability?: string;
  lookup?: string;
}

/**
 * Compact, read-only rendering of a plan step's reasoning contract (the `io`
 * object emitted by the planner). Falls back to nothing when older plans
 * don't carry `io`.
 */
export function StepReasoning({ io }: { io?: StepIo | null }) {
  if (!io || typeof io !== "object") return null;
  const rows: Array<[string, string | undefined]> = [
    ["Uses", io.inputs],
    ["From", io.inputSource],
    ["Does", io.operation],
    ["Output", io.output],
    ["Goes to", io.destination],
    ["Looks up", io.lookup && io.lookup.toLowerCase() !== "none" ? io.lookup : undefined],
  ];
  const visible = rows.filter(([, v]) => typeof v === "string" && v.trim());
  if (!visible.length) return null;
  return (
    <div className="mt-1 space-y-0.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
      {visible.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <span className="shrink-0 font-medium text-foreground/70">{label}:</span>
          <span className="break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}
