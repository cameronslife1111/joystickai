// KEEP IN SYNC with src/lib/recurrence.ts — duplicated here so Deno edge
// functions can share the exact same fire-time math as the TanStack server fns.

// Recurrence math for plan_schedules. Pure functions — safe in browser, server
// functions, and the scheduler tick. No Date arithmetic across DST boundaries
// without going through Intl, because "9:00 AM local" must mean 9 AM in the
// user's wall clock even after DST transitions.
//
// Cadences supported: once | hourly | daily | weekly | monthly | yearly.
//
// Schedule fields used here mirror the DB columns 1:1. Only the subset that
// matters for "compute next fire time" is required.

export type Cadence = "once" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export type ScheduleSpec = {
  cadence: Cadence;
  interval_n: number;                // every N hours/days/weeks/months/years (>=1)
  time_of_day: string | null;        // "HH:MM" in `timezone`, required for daily+
  timezone: string;                  // IANA TZ
  weekdays: number[];                // 0=Sun..6=Sat, for weekly
  month_days: number[];              // 1..31, for monthly
  year_month_days: { month: number; day: number }[]; // 1..12 / 1..31, for yearly
  starts_at: string | null;          // ISO; for `once` this IS the run time
  ends_at: string | null;            // ISO hard stop (inclusive bound)
  max_runs: number | null;
  run_count: number;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function parseHHMM(value: string | null): { h: number; m: number } | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/** Format a Date's wall-clock parts in the given IANA timezone. */
function partsInTZ(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour === "24" ? "0" : out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: weekdayMap[out.weekday] ?? 0,
  };
}

/** Construct a UTC Date corresponding to the given wall-clock in TZ.
 *  Uses two-pass correction to handle DST. */
function zonedTimeToUtc(
  year: number,
  month: number, // 1..12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // First guess assuming UTC.
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const parts = partsInTZ(new Date(guess), timeZone);
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const observedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const offset = observedUtc - targetUtc;
    if (offset === 0) break;
    guess -= offset;
  }
  return new Date(guess);
}

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
}

/**
 * Compute the next fire time strictly AFTER `from`. Returns null if the
 * schedule has no future fire (e.g. one-shot in the past, exhausted runs,
 * or past ends_at).
 */
export function nextRunAt(spec: ScheduleSpec, from: Date = new Date()): Date | null {
  if (spec.max_runs != null && spec.run_count >= spec.max_runs) return null;

  const fromMs = from.getTime();
  const endsMs = spec.ends_at ? new Date(spec.ends_at).getTime() : Infinity;
  if (endsMs < fromMs) return null;

  const startsMs = spec.starts_at ? new Date(spec.starts_at).getTime() : -Infinity;
  const floor = Math.max(fromMs, startsMs);

  let candidate: Date | null = null;

  switch (spec.cadence) {
    case "once": {
      if (!spec.starts_at) return null;
      const t = new Date(spec.starts_at).getTime();
      candidate = t > fromMs ? new Date(t) : null;
      break;
    }

    case "hourly": {
      const stepMs = Math.max(1, spec.interval_n) * MS_PER_HOUR;
      const anchorMs = Number.isFinite(startsMs) ? startsMs : floor;
      // First multiple of stepMs after `floor` measured from anchor.
      const elapsed = Math.max(0, floor - anchorMs);
      const ticks = Math.ceil((elapsed + 1) / stepMs);
      candidate = new Date(anchorMs + ticks * stepMs);
      break;
    }

    case "daily": {
      const tod = parseHHMM(spec.time_of_day) ?? { h: 9, m: 0 };
      const step = Math.max(1, spec.interval_n);
      // Walk day-by-day from `floor` forward.
      let cursor = new Date(Math.max(floor, startsMs === -Infinity ? floor : startsMs));
      const anchorParts = partsInTZ(new Date(startsMs === -Infinity ? floor : startsMs), spec.timezone);
      for (let i = 0; i < 366 * 2; i++) {
        const p = partsInTZ(cursor, spec.timezone);
        const fire = zonedTimeToUtc(p.year, p.month, p.day, tod.h, tod.m, spec.timezone);
        if (fire.getTime() > fromMs) {
          // Honor interval_n by counting days since anchor.
          const daysSinceAnchor = Math.floor(
            (Date.UTC(p.year, p.month - 1, p.day) -
              Date.UTC(anchorParts.year, anchorParts.month - 1, anchorParts.day)) /
              MS_PER_DAY,
          );
          if (daysSinceAnchor >= 0 && daysSinceAnchor % step === 0) {
            candidate = fire;
            break;
          }
        }
        cursor = new Date(cursor.getTime() + MS_PER_DAY);
      }
      break;
    }

    case "weekly": {
      const tod = parseHHMM(spec.time_of_day) ?? { h: 9, m: 0 };
      const weekdays = spec.weekdays.length > 0 ? [...spec.weekdays].sort() : [1]; // default Mon
      let cursor = new Date(floor);
      for (let i = 0; i < 14; i++) {
        const p = partsInTZ(cursor, spec.timezone);
        if (weekdays.includes(p.weekday)) {
          const fire = zonedTimeToUtc(p.year, p.month, p.day, tod.h, tod.m, spec.timezone);
          if (fire.getTime() > fromMs) {
            candidate = fire;
            break;
          }
        }
        cursor = new Date(cursor.getTime() + MS_PER_DAY);
      }
      break;
    }

    case "monthly": {
      const tod = parseHHMM(spec.time_of_day) ?? { h: 9, m: 0 };
      const days = spec.month_days.length > 0 ? [...spec.month_days].sort((a, b) => a - b) : [1];
      const fp = partsInTZ(new Date(floor), spec.timezone);
      for (let monthDelta = 0; monthDelta < 24; monthDelta++) {
        const year = fp.year + Math.floor((fp.month - 1 + monthDelta) / 12);
        const month = ((fp.month - 1 + monthDelta) % 12) + 1;
        const maxDay = daysInMonth(year, month);
        for (const d of days) {
          const day = Math.min(d, maxDay);
          const fire = zonedTimeToUtc(year, month, day, tod.h, tod.m, spec.timezone);
          if (fire.getTime() > fromMs) {
            candidate = fire;
            break;
          }
        }
        if (candidate) break;
      }
      break;
    }

    case "yearly": {
      const tod = parseHHMM(spec.time_of_day) ?? { h: 9, m: 0 };
      const entries =
        spec.year_month_days.length > 0
          ? [...spec.year_month_days].sort(
              (a, b) => a.month - b.month || a.day - b.day,
            )
          : [{ month: 1, day: 1 }];
      const fp = partsInTZ(new Date(floor), spec.timezone);
      for (let yearDelta = 0; yearDelta < 5; yearDelta++) {
        const year = fp.year + yearDelta;
        for (const e of entries) {
          const maxDay = daysInMonth(year, e.month);
          const day = Math.min(e.day, maxDay);
          const fire = zonedTimeToUtc(year, e.month, day, tod.h, tod.m, spec.timezone);
          if (fire.getTime() > fromMs) {
            candidate = fire;
            break;
          }
        }
        if (candidate) break;
      }
      break;
    }
  }

  if (!candidate) return null;
  if (candidate.getTime() > endsMs) return null;
  if (candidate.getTime() < startsMs) return null;
  return candidate;
}

/** Compute up to N future fire times — used by the UI preview. */
export function nextNRuns(spec: ScheduleSpec, n: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  let cursor = from;
  let runCount = spec.run_count;
  for (let i = 0; i < n; i++) {
    const next = nextRunAt({ ...spec, run_count: runCount }, cursor);
    if (!next) break;
    out.push(next);
    // Advance the cursor 1ms past the candidate so we don't re-pick it.
    cursor = new Date(next.getTime() + 1);
    runCount += 1;
  }
  return out;
}

/** Bump a candidate forward by `minMinutes` if it collides with an existing
 *  fire time within that window. Used to enforce the 30-min spacing rule
 *  client-side as a preview. */
export function nudgePast(
  candidate: Date,
  others: Date[],
  minMinutes: number,
): { adjusted: Date; bumped: boolean } {
  const win = minMinutes * MS_PER_MINUTE;
  let t = candidate.getTime();
  let bumped = false;
  // At most a handful of iterations — schedules are sparse.
  for (let i = 0; i < 100; i++) {
    const collision = others.find((o) => Math.abs(o.getTime() - t) < win);
    if (!collision) break;
    t = collision.getTime() + win;
    bumped = true;
  }
  return { adjusted: new Date(t), bumped };
}

/** Browser-friendly default TZ. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
