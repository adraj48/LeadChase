import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentResult } from "@/lib/agent";

// Minimal stand-in for the supabase-js query builder: records the calls and resolves
// to whatever `respond` returns for the finished query.
type Call = {
  table: string;
  op: string;
  payload?: unknown;
  select?: string;
  filters: [string, unknown][];
  orders: [string, unknown][];
};
function fakeClient(respond: (c: Call) => { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [], orders: [] };
    const b: Record<string, unknown> = {
      select(cols: string) {
        call.select = cols;
        return b;
      },
      update(payload: unknown) {
        call.op = "update";
        call.payload = payload;
        return b;
      },
      insert(payload: unknown) {
        call.op = "insert";
        call.payload = payload;
        return b;
      },
      eq(col: string, val: unknown) {
        call.filters.push([col, val]);
        return b;
      },
      order(col: string, opts?: unknown) {
        call.orders.push([col, opts]);
        return b;
      },
      maybeSingle: () => b,
      single: () => b,
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        calls.push(call);
        return Promise.resolve(respond(call)).then(resolve, reject);
      },
    };
    return b;
  };
  return { sb: { from } as never, calls };
}

const row = {
  id: "l1", rep_id: "r1", name: "A", company: "B", phone: "+911234567890", source: "Website",
  last_contact_date: "2026-10-01", tag: "Hot", reason: "r", follow_up_date: "2026-10-30", draft: "old",
  analysis_source: "seed", reps: { name: "Rep" },
};
const prov: AgentResult = { tag: "Hot", reason: "why", followUpDate: "2026-10-30", draft: "RULE DRAFT", analysisSource: "fallback" };
const missingCol = { code: "42703", message: "column leads.analysis_status does not exist" };

let repo: typeof import("@/lib/repo");
beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  repo = await import("@/lib/repo");
});

describe("beginAnalysis", () => {
  it("writes the provisional tag/reason/date as pending and leaves the draft untouched", async () => {
    const { sb, calls } = fakeClient(() => ({ data: [{ ...row, analysis_status: "pending", analysis_started_at: "2026-10-29T10:00:00.000Z" }], error: null }));
    const r = await repo.beginAnalysis(sb, "l1", prov, "2026-10-29T10:00:00.000Z", "2026-10-29");
    expect(r.kind).toBe("ok");
    const patch = calls[0].payload as Record<string, unknown>;
    expect(patch).toEqual({
      tag: "Hot",
      reason: "why",
      follow_up_date: "2026-10-30",
      analysis_status: "pending",
      analysis_started_at: "2026-10-29T10:00:00.000Z",
      last_contact_date: "2026-10-29",
    });
    expect(patch).not.toHaveProperty("draft");
    expect(patch).not.toHaveProperty("analysis_source");
    if (r.kind === "ok") expect(r.lead.analysisStatus).toBe("pending");
  });
  it("omits last_contact_date when not given", async () => {
    const { sb, calls } = fakeClient(() => ({ data: [row], error: null }));
    await repo.beginAnalysis(sb, "l1", prov, "2026-10-29T10:00:00.000Z");
    expect(calls[0].payload).not.toHaveProperty("last_contact_date");
  });
  it("no row back (hidden by RLS) => not-found", async () => {
    const { sb } = fakeClient(() => ({ data: [], error: null }));
    expect((await repo.beginAnalysis(sb, "l1", prov, "x")).kind).toBe("not-found");
  });
  it("missing columns => legacy, and later calls skip the failing query for a while", async () => {
    const { sb, calls } = fakeClient(() => ({ data: null, error: { code: "PGRST204", message: "Could not find the 'analysis_started_at' column of 'leads' in the schema cache" } }));
    expect((await repo.beginAnalysis(sb, "l1", prov, "x")).kind).toBe("legacy");
    expect(repo.analysisColumnsMissing()).toBe(true);
    expect((await repo.beginAnalysis(sb, "l1", prov, "x")).kind).toBe("legacy");
    expect(calls).toHaveLength(1);
  });
  it("other database errors are not mistaken for missing columns", async () => {
    const { sb } = fakeClient(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    await expect(repo.beginAnalysis(sb, "l1", prov, "x")).rejects.toThrow("permission denied");
    expect(repo.analysisColumnsMissing()).toBe(false);
  });
});

describe("finishAnalysis / markReady", () => {
  it("writes the final result as ready, guarded by the analysis start time", async () => {
    const { sb, calls } = fakeClient(() => ({ data: [{ id: "l1" }], error: null }));
    expect(await repo.finishAnalysis(sb, "l1", { ...prov, analysisSource: "llm" }, "T")).toBe(true);
    expect(calls[0].payload).toEqual({
      tag: "Hot", reason: "why", follow_up_date: "2026-10-30", draft: "RULE DRAFT",
      analysis_source: "llm", analysis_status: "ready",
    });
    expect(calls[0].filters).toEqual([["id", "l1"], ["analysis_started_at", "T"]]);
  });
  it("a superseded analysis writes nothing (0 rows) and reports false", async () => {
    const { sb } = fakeClient(() => ({ data: [], error: null }));
    expect(await repo.finishAnalysis(sb, "l1", prov, "T")).toBe(false);
  });
  it("markReady only flips the status, with the same guard", async () => {
    const { sb, calls } = fakeClient(() => ({ data: [], error: null }));
    await repo.markReady(sb, "l1", "T");
    expect(calls[0].payload).toEqual({ analysis_status: "ready" });
    expect(calls[0].filters).toContainEqual(["analysis_started_at", "T"]);
  });
});

describe("reads", () => {
  const msgRow = (id: string, at: string) => ({ id, lead_id: "l1", sender: "buyer", body: `b-${id}`, sent_at: at });
  it("getLead reads lead, rep name and chat in ONE request (embedded, oldest message first)", async () => {
    const { sb, calls } = fakeClient(() => ({
      data: { ...row, analysis_status: "ready", analysis_started_at: null, messages: [msgRow("m1", "2026-10-01T00:00:00Z"), msgRow("m2", "2026-10-02T00:00:00Z")] },
      error: null,
    }));
    const found = await repo.getLead(sb, "l1");
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("leads");
    expect(calls[0].select).toContain("reps(name)");
    expect(calls[0].select).toContain("messages(id, lead_id, sender, body, sent_at)");
    expect(calls[0].filters).toEqual([["id", "l1"]]);
    expect(calls[0].orders[0]).toEqual(["sent_at", { referencedTable: "messages", ascending: true }]);
    expect(found?.lead).not.toHaveProperty("messages");
    expect(found?.lead.repName).toBe("Rep");
    expect(found?.messages).toEqual([
      { id: "m1", leadId: "l1", from: "buyer", text: "b-m1", at: "2026-10-01T00:00:00Z" },
      { id: "m2", leadId: "l1", from: "buyer", text: "b-m2", at: "2026-10-02T00:00:00Z" },
    ]);
  });
  it("getLead: no row => null; no messages => empty chat", async () => {
    expect(await repo.getLead(fakeClient(() => ({ data: null, error: null })).sb, "l1")).toBeNull();
    const empty = await repo.getLead(fakeClient(() => ({ data: { ...row, messages: [] }, error: null })).sb, "l1");
    expect(empty?.messages).toEqual([]);
  });
  it("listLeads is one request, filtered only when a rep is given", async () => {
    const all = fakeClient(() => ({ data: [row], error: null }));
    await repo.listLeads(all.sb);
    expect(all.calls).toHaveLength(1);
    expect(all.calls[0].filters).toEqual([]);
    const one = fakeClient(() => ({ data: [row], error: null }));
    await repo.listLeads(one.sb, "r1");
    expect(one.calls[0].filters).toEqual([["rep_id", "r1"]]);
  });
  it("listReps / getRep return { id, name } for role = 'rep' rows only", async () => {
    const list = fakeClient(() => ({ data: [{ id: "r1", name: "Amit" }], error: null }));
    expect(await repo.listReps(list.sb)).toEqual([{ id: "r1", name: "Amit" }]);
    expect(list.calls[0]).toMatchObject({ table: "reps", select: "id, name", filters: [["role", "rep"]] });
    expect(list.calls[0].orders[0][0]).toBe("name");
    const one = fakeClient(() => ({ data: null, error: null }));
    expect(await repo.getRep(one.sb, "r9")).toBeNull();
    expect(one.calls[0].filters).toEqual([["id", "r9"], ["role", "rep"]]);
  });
  it("addMessage: a missing parent lead (FK violation) => null, other errors throw", async () => {
    const gone = fakeClient(() => ({ data: null, error: { code: "23503", message: "violates foreign key constraint" } }));
    expect(await repo.addMessage(gone.sb, "l1", "rep", "x")).toBeNull();
    const down = fakeClient(() => ({ data: null, error: { code: "08006", message: "connection failure" } }));
    await expect(repo.addMessage(down.sb, "l1", "rep", "x")).rejects.toThrow("connection failure");
  });
});

describe("compatibility with a database without the new columns", () => {
  it("getLead retries its single query once without the new columns", async () => {
    const { sb, calls } = fakeClient((c) =>
      c.select?.includes("analysis_status") ? { data: null, error: missingCol } : { data: { ...row, messages: [] }, error: null },
    );
    const found = await repo.getLead(sb, "l1");
    expect(found?.lead.analysisStatus).toBeUndefined(); // treated as ready by the client
    const leadSelects = calls.map((c) => c.select);
    expect(leadSelects).toHaveLength(2);
    expect(leadSelects[1]).not.toContain("analysis_status");
    expect(leadSelects[1]).toContain("messages(");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
  it("listLeads falls back the same way", async () => {
    const { sb } = fakeClient((c) =>
      c.select?.includes("analysis_status") ? { data: null, error: missingCol } : { data: [row], error: null },
    );
    expect(await repo.listLeads(sb)).toHaveLength(1);
  });
  it("uses the new columns when present", async () => {
    const { sb, calls } = fakeClient(() => ({ data: { ...row, analysis_status: "ready", analysis_started_at: null, messages: [] }, error: null }));
    const found = await repo.getLead(sb, "l1");
    expect(found?.lead.analysisStatus).toBe("ready");
    expect(calls).toHaveLength(1);
  });
});
