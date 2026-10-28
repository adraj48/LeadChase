import { describe, it, expect } from "vitest";
import {
  PENDING_TTL_MS,
  POLL_MAX_MS,
  REALTIME_GRACE_MS,
  acceptsResponse,
  classifyIncoming,
  isPending,
  mergeRow,
  pollDecision,
  resolveFinalDraft,
} from "@/lib/analysis-state";
import type { Lead } from "@/lib/types";

const T0 = Date.parse("2026-10-29T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const pending = (ms: number) => ({ analysisStatus: "pending" as const, analysisStartedAt: iso(ms) });
const ready = (ms: number | null) => ({
  analysisStatus: "ready" as const,
  analysisStartedAt: ms === null ? null : iso(ms),
});

describe("isPending (stuck-state recovery)", () => {
  it("is pending shortly after the start", () => {
    expect(isPending(pending(T0), T0 + 5_000)).toBe(true);
    expect(isPending(pending(T0), T0 + PENDING_TTL_MS - 1)).toBe(true);
  });
  it("is treated as ready once pending for 90 s or more", () => {
    expect(isPending(pending(T0), T0 + PENDING_TTL_MS)).toBe(false);
    expect(isPending(pending(T0), T0 + 10 * 60_000)).toBe(false);
  });
  it("ready, missing columns and pending without a start time are not pending", () => {
    expect(isPending(ready(T0), T0)).toBe(false);
    expect(isPending({}, T0)).toBe(false);
    expect(isPending({ analysisStatus: "pending", analysisStartedAt: null }, T0)).toBe(false);
    expect(isPending({ analysisStatus: "pending", analysisStartedAt: "garbage" }, T0)).toBe(false);
  });
});

describe("classifyIncoming (provisional then final, stale ordering)", () => {
  it("a newer pending analysis is provisional", () => {
    expect(classifyIncoming(ready(null), pending(T0))).toBe("provisional");
    expect(classifyIncoming(ready(T0), pending(T0 + 1000))).toBe("provisional");
  });
  it("the final row of the analysis on screen is final", () => {
    expect(classifyIncoming(pending(T0), ready(T0))).toBe("final");
  });
  it("a final row of a newer analysis is final even if its pending push was missed", () => {
    expect(classifyIncoming(ready(T0), ready(T0 + 5000))).toBe("final");
    expect(classifyIncoming(pending(T0), ready(T0 + 5000))).toBe("final");
  });
  it("drops events older than the analysis on screen", () => {
    expect(classifyIncoming(pending(T0 + 5000), ready(T0))).toBe("ignore");
    expect(classifyIncoming(pending(T0 + 5000), pending(T0))).toBe("ignore");
    expect(classifyIncoming(ready(T0 + 5000), ready(T0))).toBe("ignore");
  });
  it("drops the echo of what is already shown (dedupe with the POST response)", () => {
    expect(classifyIncoming(pending(T0), pending(T0))).toBe("ignore");
    expect(classifyIncoming(ready(T0), ready(T0))).toBe("ignore");
  });
  it("never goes backwards from ready to pending of the same analysis", () => {
    expect(classifyIncoming(ready(T0), pending(T0))).toBe("ignore");
  });
  it("ignores a rep's own draft save (same analysis, still ready)", () => {
    expect(classifyIncoming(ready(T0), ready(T0))).toBe("ignore");
    expect(classifyIncoming(ready(null), ready(null))).toBe("ignore");
  });
  it("out-of-order pair: final of analysis 1 arriving after pending of analysis 2", () => {
    // on screen: analysis 2 pending; the late final of analysis 1 must not replace it
    expect(classifyIncoming(pending(T0 + 3000), ready(T0))).toBe("ignore");
  });
});

describe("acceptsResponse (POST response vs push race)", () => {
  it("accepts the pending response over a ready lead", () => {
    expect(acceptsResponse(ready(null), pending(T0))).toBe(true);
    expect(acceptsResponse(ready(T0 - 1000), pending(T0))).toBe(true);
  });
  it("accepts an equal state, so a database without the columns still applies", () => {
    expect(acceptsResponse({}, {})).toBe(true);
    expect(acceptsResponse(ready(T0), ready(T0))).toBe(true);
  });
  it("rejects a slow response that lost the race to the final push", () => {
    expect(acceptsResponse(ready(T0), pending(T0))).toBe(false);
    expect(acceptsResponse(ready(T0 + 1000), pending(T0))).toBe(false);
  });
});

describe("resolveFinalDraft (dirty-draft protection)", () => {
  it("replaces a clean draft", () => {
    expect(resolveFinalDraft({ text: "old", saved: "old" }, "new")).toEqual({
      kind: "replace",
      text: "new",
      saved: "new",
    });
  });
  it("never overwrites unsaved edits: offers a suggestion instead", () => {
    expect(resolveFinalDraft({ text: "my words", saved: "old" }, "new")).toEqual({
      kind: "suggest",
      suggestion: "new",
    });
  });
  it("an unsaved draft that already equals the new text is simply marked saved", () => {
    expect(resolveFinalDraft({ text: "new", saved: "old" }, "new")).toEqual({
      kind: "replace",
      text: "new",
      saved: "new",
    });
  });
  it("an emptied but unsaved draft counts as the rep's edit", () => {
    expect(resolveFinalDraft({ text: "", saved: "old" }, "new").kind).toBe("suggest");
  });
});

describe("pollDecision (fallback when Realtime is not delivering)", () => {
  it("is idle when nothing is pending", () => {
    expect(pollDecision({ pending: false, channel: "down", pendingForMs: 10_000 })).toBe("idle");
  });
  it("polls immediately when the channel is down", () => {
    expect(pollDecision({ pending: true, channel: "down", pendingForMs: 0 })).toBe("poll");
    expect(pollDecision({ pending: true, channel: "down", pendingForMs: 2000 })).toBe("poll");
  });
  it("waits for the push while the channel is subscribed or connecting", () => {
    expect(pollDecision({ pending: true, channel: "subscribed", pendingForMs: 2000 })).toBe("wait");
    expect(pollDecision({ pending: true, channel: "connecting", pendingForMs: REALTIME_GRACE_MS - 1 })).toBe("wait");
  });
  it("polls once no push arrived within the grace period, even on a 'subscribed' channel", () => {
    expect(pollDecision({ pending: true, channel: "subscribed", pendingForMs: REALTIME_GRACE_MS })).toBe("poll");
    expect(pollDecision({ pending: true, channel: "connecting", pendingForMs: 30_000 })).toBe("poll");
  });
  it("gives up after the polling window so the draft is never locked forever", () => {
    expect(pollDecision({ pending: true, channel: "down", pendingForMs: POLL_MAX_MS })).toBe("give-up");
    expect(pollDecision({ pending: true, channel: "subscribed", pendingForMs: POLL_MAX_MS + 1 })).toBe("give-up");
  });
});

describe("mergeRow", () => {
  it("keeps the joined rep name that a raw Realtime row does not carry", () => {
    const cur = { id: "l", repName: "Anil", tag: "Cold" } as Lead;
    const row = { id: "l", repName: "", tag: "Hot" } as Lead;
    expect(mergeRow(cur, row)).toEqual({ id: "l", repName: "Anil", tag: "Hot" });
  });
});

describe("whole flow without Realtime (polling only)", () => {
  it("provisional response, then a polled final row applies once and ends the wait", () => {
    let shown: Lead = { id: "l", draft: "old", ...ready(null) } as Lead;
    // POST response: provisional
    const resp = { id: "l", draft: "old", ...pending(T0) } as Lead;
    expect(acceptsResponse(shown, resp)).toBe(true);
    shown = resp;
    expect(isPending(shown, T0 + 1000)).toBe(true);
    // poll tick 1: still pending, same analysis -> nothing to apply
    expect(classifyIncoming(shown, { ...resp })).toBe("ignore");
    // poll tick 2: final
    const final = { id: "l", draft: "new", ...ready(T0) } as Lead;
    expect(classifyIncoming(shown, final)).toBe("final");
    shown = final;
    expect(isPending(shown, T0 + 5000)).toBe(false);
    // a duplicate delivery (push after poll) is dropped
    expect(classifyIncoming(shown, final)).toBe("ignore");
  });
});
