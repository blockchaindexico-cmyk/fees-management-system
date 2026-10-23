// Taking families from today's call list and giving them back (API: /api/calls/take, /api/calls/release).
// Logging a call is in ../parents/actions.ts (logCall).

import { api, submit } from "@/lib/api/client";
import type { ActionState } from "@/lib/action-state";

type Result = { message: string };
const withMessage = (r: Result): ActionState => ({ ok: true, message: r.message });

/** The next `count` families of today's list (default: the school's batch size). */
export function takeCalls(count?: number): Promise<ActionState> {
  return submit(() => api.post<Result>("/api/calls/take", count ? { count } : {}), withMessage);
}

/** One family onto my list for today. */
export function takeFamily(parentId: string): Promise<ActionState> {
  return submit(() => api.post<Result>("/api/calls/take", { parent_id: parentId }), withMessage);
}

/** One family back to today's list, or (no id) every family of mine not called yet. */
export function releaseCalls(parentId?: string): Promise<ActionState> {
  return submit(() => api.post<Result>("/api/calls/release", parentId ? { parent_id: parentId } : {}), withMessage);
}
