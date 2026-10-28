// Demo mode has no login: every visitor sees the same data, and the only scoping is
// the rep picker ("All reps" or one rep), sent as ?rep=<uuid|all>.
import { UUID_RE } from "@/lib/validate";
import type { Viewer } from "@/lib/types";

export const ALL_REPS = "all";

export type RepScope = { kind: "all" } | { kind: "rep"; repId: string } | { kind: "invalid" };

/** Parses ?rep=. Missing, empty or "all" means every rep; otherwise it must be a uuid. */
export function parseRepScope(raw: string | null): RepScope {
  const v = raw?.trim() ?? "";
  if (v === "" || v.toLowerCase() === ALL_REPS) return { kind: "all" };
  if (UUID_RE.test(v)) return { kind: "rep", repId: v.toLowerCase() };
  return { kind: "invalid" };
}

// The `me` of GET /api/leads. Without a login every visitor is this fixed viewer: the
// retired owner role now just means "can see and filter all reps".
export const ALL_REPS_VIEWER: Viewer = { id: ALL_REPS, name: "All reps", email: "", role: "owner" };
