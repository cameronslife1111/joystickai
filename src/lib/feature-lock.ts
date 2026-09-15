// Tester rollout gate.
//
// Accounts created from CUTOFF onwards cannot use the heavy features
// (virtual computer + all video generation). Every account that existed
// before CUTOFF keeps them exactly as before.
//
// To give everyone the features back, flip UNLOCK_ALL to true. Nothing else
// needs to change.
import type { ChatCapabilities } from "@/lib/chat-types";

/** Master switch: true = nobody is locked. */
export const UNLOCK_ALL = false;

/** Accounts created at or after this moment are locked. */
export const LOCK_CUTOFF_ISO = "2026-09-15T00:00:00.000Z";

/** Chat capabilities held back from locked accounts. */
export const LOCKED_CAPABILITY_KEYS = ["virtual_computer", "video_generation"] as const;

/** Plan tool names held back from locked accounts. */
export const LOCKED_TOOL_GROUPS = ["video_generation", "virtual_computer"] as const;

/** True when this account signed up after the cutoff (and we're still locked). */
export function isFeatureLocked(userCreatedAt: string | null | undefined): boolean {
  if (UNLOCK_ALL) return false;
  if (!userCreatedAt) return false; // unknown age → treat as existing account
  const created = Date.parse(userCreatedAt);
  if (Number.isNaN(created)) return false;
  return created >= Date.parse(LOCK_CUTOFF_ISO);
}

/** Force the locked capabilities off. Safe to call with partial objects. */
export function applyFeatureLock<T extends Partial<ChatCapabilities>>(
  caps: T,
  locked: boolean,
): T {
  if (!locked) return caps;
  const next = { ...caps } as T;
  for (const key of LOCKED_CAPABILITY_KEYS) {
    if (key in next) (next as Record<string, unknown>)[key] = false;
  }
  return next;
}
