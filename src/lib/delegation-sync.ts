// Pure helpers for keeping a live call's view of a delegated backend job in
// step with what actually finished. Kept side-effect free so the lifecycle can
// be unit tested without WebRTC or the database.

export type DelegatedJob = {
  /** GPT-Live delegation this job answers. */
  delegationId: string;
  /** Queued chat_turns row id. */
  turnId: string;
  /** Conversation the job belongs to — captured once, never re-read. */
  threadId: string;
  /** Message row the spoken request was saved as, when known. */
  messageId: string | null;
};

export type TurnOutcome = {
  status: string;
  route?: string | null;
  error?: string | null;
  assistantMessageId?: string | null;
};

/** Terminal chat_turns statuses — nothing more will happen to the row. */
export const TERMINAL_TURN_STATUSES = ["done", "failed", "canceled"] as const;

export function isTerminalTurnStatus(status: string | null | undefined): boolean {
  return (TERMINAL_TURN_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * True when this delegation callback is new. Repeated callbacks for the same
 * delegation must never queue a second turn or write a second message.
 */
export function shouldHandleDelegation(handled: Set<string>, delegationId: string): boolean {
  if (!delegationId) return false;
  if (handled.has(delegationId)) return false;
  handled.add(delegationId);
  return true;
}

/**
 * The silent completion note sent back to the voice model, tagged with the
 * originating delegation so the open job is provably closed. Returns null when
 * the turn hasn't finished yet.
 */
export function buildCompletionNote(outcome: TurnOutcome): string | null {
  if (!isTerminalTurnStatus(outcome.status)) return null;

  if (outcome.status === "canceled") {
    return (
      "Your backend job was stopped before it finished. It is no longer running. " +
      "Say so plainly if it comes up; do not claim you are still working on it."
    );
  }

  if (outcome.status === "failed") {
    return (
      "Your backend job has FINISHED and it failed. It is no longer running. " +
      "Tell the user briefly that it didn't work and offer to try again. " +
      "Never say you are still working on it."
    );
  }

  const route = outcome.route ?? "";
  if (route === "plan") {
    return (
      "Your backend job has FINISHED: a plan was written and started, and its own updates will arrive " +
      "as separate results. Nothing is pending from you. Never say you are still waiting on this request."
    );
  }
  if (route === "resumed") {
    return (
      "Your backend job has FINISHED: the user's answer was handed to the plan that was waiting for it, " +
      "and the plan is carrying on. There is no reply to read out for this one, and nothing is pending " +
      "from you. Never say you are still working on it."
    );
  }
  return (
    "Your backend job has FINISHED and its result has been delivered to this conversation. " +
    "Nothing is pending from you. Treat the result as complete and never say you are still working on it."
  );
}

/** One-line structured log payload. Carries ids and status only — never text of secrets. */
export function delegationLog(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): [string, Record<string, unknown>] {
  return [`[live delegation] ${event}`, fields];
}
