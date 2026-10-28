import type { Lead } from "@/lib/types";

// Pure logic for the "provisional now, final later" analysis flow. No React, no
// network: the UI feeds it state and acts on the answers, so every rule here is
// unit-tested.
//
// State machine of a lead's analysis (columns analysis_status / analysis_started_at):
//
//   ready --(message added or draft sent)--> pending --(model result written)--> ready
//                                               |
//                                               +--(still pending after 90 s)--> treated as ready
//
// analysis_started_at is stamped on every pending write and kept by the final
// write, so it is a per-analysis counter: a larger value is always newer.

/** A pending analysis older than this is treated as ready (function was killed). */
export const PENDING_TTL_MS = 90_000;
/** How long to wait for a Realtime push before polling as a backup. */
export const REALTIME_GRACE_MS = 6_000;
/** Poll cadence while falling back. */
export const POLL_INTERVAL_MS = 2_000;
/** Stop waiting (and unlock the draft) after this long on the client. */
export const POLL_MAX_MS = 60_000;

export type AnalysisFields = Pick<Lead, "analysisStatus" | "analysisStartedAt">;

function startedMs(l: AnalysisFields): number {
  const t = l.analysisStartedAt ? Date.parse(l.analysisStartedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

// A row without the columns (database not migrated yet) counts as ready.
function rank(l: AnalysisFields): 0 | 1 {
  return l.analysisStatus === "pending" ? 0 : 1;
}

/**
 * Is the model result for this lead still being written? A 'pending' row with no
 * start time, or one older than PENDING_TTL_MS, is NOT pending: that is the
 * stuck-state recovery, so the UI never waits on a dead job. (A later write
 * overwrites the stale marker.)
 */
export function isPending(lead: AnalysisFields, now: number): boolean {
  if (lead.analysisStatus !== "pending") return false;
  const started = startedMs(lead);
  if (!started) return false;
  return now - started < PENDING_TTL_MS;
}

export type Incoming = "ignore" | "provisional" | "final";

/**
 * Classify a pushed or polled row against what is on screen.
 * - ignore: older analysis, or the same analysis at the same or an earlier stage
 *   (this is also how the POST response and the Realtime echo of it are deduped,
 *   and how a rep's own draft save, which re-sends the row unchanged, is ignored)
 * - provisional: a newer analysis that is still pending (tag/reason/date only)
 * - final: the model result for the analysis on screen, or a newer one
 */
export function classifyIncoming(current: AnalysisFields, incoming: AnalysisFields): Incoming {
  const cg = startedMs(current);
  const ig = startedMs(incoming);
  if (ig < cg) return "ignore";
  if (ig === cg && rank(incoming) <= rank(current)) return "ignore";
  return rank(incoming) === 1 ? "final" : "provisional";
}

/**
 * Should an API response (from our own POST) replace what is on screen? Unlike
 * pushed events this also accepts an equal state (so a database without the new
 * columns, where everything is "ready", still applies), and rejects only a response
 * that is provably older, e.g. a slow reply that lost the race to the final push.
 */
export function acceptsResponse(current: AnalysisFields, response: AnalysisFields): boolean {
  const cg = startedMs(current);
  const rg = startedMs(response);
  if (rg < cg) return false;
  if (rg === cg && rank(response) < rank(current)) return false;
  return true;
}

export interface DraftState {
  text: string;
  saved: string;
}

export type DraftOutcome =
  | { kind: "replace"; text: string; saved: string }
  | { kind: "suggest"; suggestion: string };

/**
 * A final draft arrived. Never overwrite what the rep typed: if the textarea has
 * unsaved edits, keep them and surface the new text as a suggestion they can apply.
 */
export function resolveFinalDraft(draft: DraftState, incoming: string): DraftOutcome {
  const dirty = draft.text !== draft.saved;
  if (!dirty || draft.text === incoming) return { kind: "replace", text: incoming, saved: incoming };
  return { kind: "suggest", suggestion: incoming };
}

export type ChannelState = "connecting" | "subscribed" | "down";
export type PollDecision = "idle" | "wait" | "poll" | "give-up";

/**
 * What to do on each 2 s tick while the draft is pending.
 * - realtime down (error, timeout, closed): poll straight away
 * - realtime up or still connecting: wait for the push, poll once REALTIME_GRACE_MS
 *   has passed without it
 * - after POLL_MAX_MS give up and let the rep carry on (the old draft stays)
 * Realtime delivering the final row clears `pending`, which ends this loop.
 */
export function pollDecision(i: {
  pending: boolean;
  channel: ChannelState;
  pendingForMs: number;
}): PollDecision {
  if (!i.pending) return "idle";
  if (i.pendingForMs >= POLL_MAX_MS) return "give-up";
  if (i.channel === "down") return "poll";
  return i.pendingForMs >= REALTIME_GRACE_MS ? "poll" : "wait";
}

/** Merge a raw pushed row (no joined rep name) onto the lead on screen. */
export function mergeRow(current: Lead, row: Lead): Lead {
  return { ...row, repName: current.repName };
}
