// Server-only: TypeSafe Jev — the instant decision engine.
//
// Jev is not a writer. It answers pre-enumerated, typed questions about a
// state in a single forward pass (tens of milliseconds), so it is what Remote
// uses to decide "which thing do I press next?" on every browser tick.
//
// Billed to the user's own TypeSafe account via TYPESAFE_API_KEY.
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

export type JevChoice = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type JevScore = { type: "score"; score: number; confidence: number };
export type JevNoul = { type: "noul"; noul: number };
export type JevAnswer = JevChoice | JevScore | JevNoul;

export type JevQuestion =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] }
  | { type: "noul"; instructions: unknown; criteria?: Record<string, unknown> };

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * Ask Jev a batch of independent typed questions about one state.
 * Batching is free-ish: everything below is answered in a single pass.
 */
export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer>> {
  const key = process.env["TYPESAFE_API_KEY"];
  if (!key) throw new JevError("The instant decision engine isn't set up yet (missing TypeSafe key).", null);

  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      detail = String(body?.error?.message ?? body?.message ?? body?.detail ?? detail);
    } catch {
      /* keep raw */
    }
    throw new JevError(`TypeSafe ${res.status}: ${detail}`, res.status);
  }
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new JevError("TypeSafe returned something unreadable.", res.status);
  }
  const answers = body?.answers;
  if (!answers || typeof answers !== "object") throw new JevError("TypeSafe returned no answers.", res.status);
  return answers as Record<string, JevAnswer>;
}

export function pickChoice(a: JevAnswer | undefined): { id: string; p: number; confidence: number } | null {
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  const p = Number(a.probabilities?.[a.choice] ?? 0);
  return { id: a.choice, p: Number.isFinite(p) ? p : 0, confidence: Number(a.confidence ?? 0) };
}

export function noulOf(a: JevAnswer | undefined): number {
  if (!a || a.type !== "noul") return 0;
  const v = Number(a.noul);
  return Number.isFinite(v) ? v : 0;
}
