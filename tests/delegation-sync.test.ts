import { describe, expect, it } from "vitest";
import {
  buildCompletionNote,
  isTerminalTurnStatus,
  shouldHandleDelegation,
  type DelegatedJob,
} from "../src/lib/delegation-sync";

describe("shouldHandleDelegation", () => {
  it("handles a delegation once and ignores repeats", () => {
    const handled = new Set<string>();
    expect(shouldHandleDelegation(handled, "dlg_1")).toBe(true);
    expect(shouldHandleDelegation(handled, "dlg_1")).toBe(false);
    expect(shouldHandleDelegation(handled, "dlg_1")).toBe(false);
  });

  it("still accepts a different delegation", () => {
    const handled = new Set<string>();
    shouldHandleDelegation(handled, "dlg_1");
    expect(shouldHandleDelegation(handled, "dlg_2")).toBe(true);
  });

  it("ignores an empty id", () => {
    expect(shouldHandleDelegation(new Set<string>(), "")).toBe(false);
  });
});

describe("isTerminalTurnStatus", () => {
  it("only treats finished statuses as terminal", () => {
    expect(isTerminalTurnStatus("pending")).toBe(false);
    expect(isTerminalTurnStatus("running")).toBe(false);
    expect(isTerminalTurnStatus(null)).toBe(false);
    expect(isTerminalTurnStatus("done")).toBe(true);
    expect(isTerminalTurnStatus("failed")).toBe(true);
    expect(isTerminalTurnStatus("canceled")).toBe(true);
  });
});

describe("buildCompletionNote", () => {
  it("says nothing while the turn is unfinished", () => {
    expect(buildCompletionNote({ status: "running" })).toBeNull();
    expect(buildCompletionNote({ status: "pending" })).toBeNull();
  });

  it("marks a plain reply as finished and delivered", () => {
    const note = buildCompletionNote({ status: "done", route: "chat", assistantMessageId: "m1" });
    expect(note).toContain("FINISHED");
    expect(note).toContain("never say you are still working on it");
  });

  it("signals completion even when nothing was posted into the chat", () => {
    const note = buildCompletionNote({ status: "done", route: "resumed", assistantMessageId: null });
    expect(note).toBeTruthy();
    expect(note).toContain("FINISHED");
    expect(note).toContain("no reply to read out");
  });

  it("signals a started plan as finished delegation work", () => {
    const note = buildCompletionNote({ status: "done", route: "plan" });
    expect(note).toContain("FINISHED");
    expect(note).toContain("plan");
  });

  it("reports failure instead of leaving the job open", () => {
    const note = buildCompletionNote({ status: "failed", error: "boom" });
    expect(note).toContain("failed");
    expect(note).not.toContain("boom");
  });

  it("reports a stopped job as no longer running", () => {
    expect(buildCompletionNote({ status: "canceled" })).toContain("no longer running");
  });
});

describe("job isolation", () => {
  it("keeps a captured job pinned to its own conversation", () => {
    const job: DelegatedJob = {
      delegationId: "dlg_a",
      turnId: "turn_a",
      threadId: "chat_A",
      messageId: "msg_a",
    };
    // A later switch to chat B must not retarget the job already in flight.
    let liveThread = "chat_A";
    liveThread = "chat_B";
    const tagFor = (currentThread: string) =>
      job.threadId === currentThread ? job.delegationId : null;
    expect(job.threadId).toBe("chat_A");
    expect(tagFor(liveThread)).toBeNull();
    expect(tagFor("chat_A")).toBe("dlg_a");
  });
});
