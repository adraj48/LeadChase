import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(() => ({})) }));
vi.mock("@/lib/repo", () => ({
  listReps: vi.fn(),
  getRep: vi.fn(),
  listLeads: vi.fn(),
  getLead: vi.fn(),
  createLead: vi.fn(),
  addMessage: vi.fn(),
  saveAnalysis: vi.fn(),
  saveDraft: vi.fn(),
  beginAnalysis: vi.fn(),
  finishAnalysis: vi.fn(),
  markReady: vi.fn(),
}));
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  analyzeLead: vi.fn(),
}));
// next/server's after() only works inside a real request: capture the callbacks and
// let each test run them explicitly (flush), which also proves the response did not wait.
const afterJobs: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterJobs.push(fn) }));
async function flush() {
  while (afterJobs.length) await afterJobs.shift()!();
}

import * as repo from "@/lib/repo";
import { analyzeLead } from "@/lib/agent";
import { GET as leadsGET, POST as leadsPOST } from "@/app/api/leads/route";
import { GET as leadGET } from "@/app/api/leads/[id]/route";
import { POST as messagesPOST } from "@/app/api/leads/[id]/messages/route";
import { POST as sentPOST } from "@/app/api/leads/[id]/sent/route";
import { PUT as draftPUT } from "@/app/api/leads/[id]/draft/route";
import { GET as repsGET } from "@/app/api/reps/route";
import { todayIST } from "@/lib/dates";
import type { Message } from "@/lib/types";

const m = vi.mocked(repo);
const agent = vi.mocked(analyzeLead);

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const rep = { id: "33333333-3333-4333-8333-333333333333", name: "Rep" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// No cookie and no auth header on any request: there is no login.
const req = (method: string, body?: unknown, url = "http://t/api/x") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const mkLead = (over = {}) => ({
  id: ID, repId: rep.id, repName: "Rep", name: "A", company: "B", phone: "+911234567890",
  source: "Website", lastContactDate: "2026-10-01", tag: "Cold" as const, reason: "r",
  followUpDate: "2026-11-01", draft: "d", analysisSource: "llm" as const, ...over,
});
const chat = (over = {}) => ({ lead: mkLead(over), messages: [{ id: "m1", leadId: ID, from: "rep" as const, text: "hi", at: "2026-10-02T00:00:00Z" }] });
const result = { tag: "Hot" as const, reason: "x", followUpDate: "2026-10-29", draft: "dd", analysisSource: "llm" as const };

const pendingLead = (p: { tag: "Hot" | "Warm" | "Cold"; reason: string; followUpDate: string }, startedAt: string) =>
  mkLead({ tag: p.tag, reason: p.reason, followUpDate: p.followUpDate, analysisStatus: "pending", analysisStartedAt: startedAt });

beforeEach(() => {
  vi.resetAllMocks();
  afterJobs.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getRep.mockResolvedValue(rep);
  agent.mockResolvedValue(result);
  m.beginAnalysis.mockImplementation(async (_sb, _id, p, startedAt) => ({ kind: "ok", lead: pendingLead(p, startedAt) }));
  m.finishAnalysis.mockResolvedValue(true);
  m.markReady.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("no login: requests without any cookie or auth header succeed", () => {
  it("every route answers without a session", async () => {
    m.listLeads.mockResolvedValue([]);
    m.listReps.mockResolvedValue([rep]);
    m.getLead.mockResolvedValue(chat());
    m.saveDraft.mockResolvedValue(true);
    m.createLead.mockResolvedValue(mkLead());
    m.addMessage.mockResolvedValue({ id: "m2", leadId: ID, from: "rep", text: "x", at: "t" });
    const body = { name: "A", company: "B", phone: "+919123456780", source: "Website", lastContactDate: "2026-10-01", repId: rep.id };
    const responses = [
      await leadsGET(req("GET", undefined, "http://t/api/leads")),
      await leadsPOST(req("POST", body)),
      await leadGET(req("GET"), ctx(ID)),
      await messagesPOST(req("POST", { from: "rep", text: "x" }), ctx(ID)),
      await sentPOST(req("POST", { draft: "y" }), ctx(ID)),
      await draftPUT(req("PUT", { draft: "x" }), ctx(ID)),
      await repsGET(req("GET")),
    ];
    for (const r of responses) {
      expect(r.status).not.toBe(401);
      expect(r.status).toBeLessThan(300);
    }
  });
});

describe("GET /api/leads", () => {
  it("returns sorted leads, today and the fixed all-reps viewer", async () => {
    const a = mkLead({ id: "a", followUpDate: "2099-01-01", tag: "Hot" });
    const b = mkLead({ id: "b", followUpDate: "2000-01-01", tag: "Cold" });
    m.listLeads.mockResolvedValue([a, b]);
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads"));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(Object.keys(j)).toEqual(["today", "me", "viewing", "leads"]);
    expect(j.today).toBe(todayIST());
    expect(j.me).toEqual({ id: "all", name: "All reps", email: "", role: "owner" });
    expect(j.leads.map((l: { id: string }) => l.id)).toEqual(["b", "a"]);
  });
  it("no ?rep= and ?rep=all list every rep's leads in one query", async () => {
    m.listLeads.mockResolvedValue([mkLead()]);
    await leadsGET(req("GET", undefined, "http://t/api/leads"));
    await leadsGET(req("GET", undefined, "http://t/api/leads?rep=all"));
    expect(m.listLeads.mock.calls.map((c) => c[1])).toEqual([undefined, undefined]);
    expect(m.getRep).not.toHaveBeenCalled();
  });
  it("?rep=<uuid> filters by that rep, one query when it has leads", async () => {
    m.listLeads.mockResolvedValue([mkLead({ repId: OTHER })]);
    const r = await leadsGET(req("GET", undefined, `http://t/api/leads?rep=${OTHER}`));
    expect(r.status).toBe(200);
    expect(m.listLeads.mock.calls[0][1]).toBe(OTHER);
    expect(m.getRep).not.toHaveBeenCalled();
  });
  it("a known rep without leads => 200 with an empty list", async () => {
    m.listLeads.mockResolvedValue([]);
    m.getRep.mockResolvedValue({ id: OTHER, name: "Other" });
    const r = await leadsGET(req("GET", undefined, `http://t/api/leads?rep=${OTHER}`));
    expect(r.status).toBe(200);
    expect((await r.json()).leads).toEqual([]);
    expect(m.getRep).toHaveBeenCalledWith(expect.anything(), OTHER);
  });
  it("an unknown rep => 400", async () => {
    m.listLeads.mockResolvedValue([]);
    m.getRep.mockResolvedValue(null);
    const r = await leadsGET(req("GET", undefined, `http://t/api/leads?rep=${OTHER}`));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Unknown rep" });
  });
  it("?rep=default resolves Sneha by name, lists her leads and reports viewing", async () => {
    m.listReps.mockResolvedValue([{ id: OTHER, name: "Arjun" }, { id: rep.id, name: "sneha IYER" }]);
    m.listLeads.mockResolvedValue([mkLead({ repId: rep.id })]);
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads?rep=default"));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.viewing).toBe(rep.id);
    expect(b.leads).toHaveLength(1);
    expect(m.listLeads.mock.calls[0][1]).toBe(rep.id);
    expect(m.getRep).not.toHaveBeenCalled();
  });
  it("?rep=default without a Sneha rep uses the first rep by name", async () => {
    m.listReps.mockResolvedValue([{ id: rep.id, name: "Zed" }, { id: OTHER, name: "Arjun" }]);
    m.listLeads.mockResolvedValue([]);
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads?rep=default"));
    expect(r.status).toBe(200);
    expect((await r.json()).viewing).toBe(OTHER);
    expect(m.listLeads.mock.calls[0][1]).toBe(OTHER);
    expect(m.getRep).not.toHaveBeenCalled();
  });
  it("?rep=default with no reps lists all leads, viewing all", async () => {
    m.listReps.mockResolvedValue([]);
    m.listLeads.mockResolvedValue([mkLead()]);
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads?rep=default"));
    expect((await r.json()).viewing).toBe("all");
    expect(m.listLeads.mock.calls[0][1]).toBeUndefined();
  });
  it("viewing is echoed for uuid and all scopes too", async () => {
    m.listLeads.mockResolvedValue([mkLead({ repId: OTHER })]);
    expect((await (await leadsGET(req("GET", undefined, `http://t/api/leads?rep=${OTHER}`))).json()).viewing).toBe(OTHER);
    expect((await (await leadsGET(req("GET", undefined, "http://t/api/leads"))).json()).viewing).toBe("all");
  });
  it("a malformed ?rep= => 400 without querying", async () => {
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads?rep=nope"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Invalid rep" });
    expect(m.listLeads).not.toHaveBeenCalled();
  });
});

describe("POST /api/leads", () => {
  const body = { name: "A", company: "B", phone: "+919123456780", source: "Website", lastContactDate: "2026-10-01", repId: OTHER };
  it("creates the lead for the chosen rep, with that rep's name for the model", async () => {
    m.getRep.mockResolvedValue({ id: OTHER, name: "Other Rep" });
    m.createLead.mockResolvedValue(mkLead({ repId: OTHER }));
    const r = await leadsPOST(req("POST", body));
    expect(r.status).toBe(201);
    expect(m.getRep).toHaveBeenCalledWith(expect.anything(), OTHER);
    expect(m.createLead.mock.calls[0][1].repId).toBe(OTHER);
    expect(agent).toHaveBeenCalledWith(expect.objectContaining({ messages: [], repName: "Other Rep" }));
  });
  it("missing repId => 400, nothing looked up or written", async () => {
    const { repId: _drop, ...noRep } = body;
    void _drop;
    const r = await leadsPOST(req("POST", noRep));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "repId is required" });
    expect(m.getRep).not.toHaveBeenCalled();
    expect(m.createLead).not.toHaveBeenCalled();
  });
  it("malformed repId => 400, nothing looked up or written", async () => {
    const r = await leadsPOST(req("POST", { ...body, repId: "nope" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "repId is invalid" });
    expect(m.getRep).not.toHaveBeenCalled();
    expect(m.createLead).not.toHaveBeenCalled();
  });
  it("unknown rep => 400 before any model call", async () => {
    m.getRep.mockResolvedValue(null);
    const r = await leadsPOST(req("POST", body));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Unknown rep" });
    expect(agent).not.toHaveBeenCalled();
    expect(m.createLead).not.toHaveBeenCalled();
  });
  it("rep deleted between lookup and insert (FK violation) => 400", async () => {
    m.createLead.mockRejectedValue(new Error("Supabase error: insert violates foreign key constraint \"leads_rep_id_fkey\""));
    const r = await leadsPOST(req("POST", body));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Unknown rep" });
  });
  it("invalid body => 400", async () => {
    const r = await leadsPOST(req("POST", { ...body, phone: "x" }));
    expect(r.status).toBe(400);
    expect(m.createLead).not.toHaveBeenCalled();
  });
  it("malformed JSON => 400", async () => {
    const r = await leadsPOST(req("POST", "{nope"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Invalid JSON" });
  });
});

describe("GET /api/leads/[id]", () => {
  it("returns lead and messages", async () => {
    m.getLead.mockResolvedValue(chat());
    const r = await leadGET(req("GET"), ctx(ID));
    expect(r.status).toBe(200);
    expect(Object.keys(await r.json())).toEqual(["lead", "messages"]);
  });
  it("404 when missing", async () => {
    m.getLead.mockResolvedValue(null);
    expect((await leadGET(req("GET"), ctx(ID))).status).toBe(404);
  });
  it("reads lead and chat with a single repo call", async () => {
    m.getLead.mockResolvedValue(chat());
    await leadGET(req("GET"), ctx(ID));
    expect(m.getLead).toHaveBeenCalledTimes(1);
    expect(m.getLead).toHaveBeenCalledWith(expect.anything(), ID);
    expect(m.listLeads).not.toHaveBeenCalled();
    expect(m.getRep).not.toHaveBeenCalled();
  });
  it("404 on invalid uuid without querying", async () => {
    const r = await leadGET(req("GET"), ctx("not-a-uuid"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Lead not found" });
    expect(m.getLead).not.toHaveBeenCalled();
  });
});

describe("POST messages", () => {
  it("blank text => 400, nothing written", async () => {
    const r = await messagesPOST(req("POST", { from: "rep", text: "   " }), ctx(ID));
    expect(r.status).toBe(400);
    expect(m.addMessage).not.toHaveBeenCalled();
  });
  it("lead not found => 404, nothing written", async () => {
    m.getLead.mockResolvedValue(null);
    const r = await messagesPOST(req("POST", { from: "rep", text: "x" }), ctx(ID));
    expect(r.status).toBe(404);
    expect(m.addMessage).not.toHaveBeenCalled();
  });
  it("invalid uuid => 404", async () => {
    const r = await messagesPOST(req("POST", { from: "rep", text: "x" }), ctx("zzz"));
    expect(r.status).toBe(404);
    expect(m.getLead).not.toHaveBeenCalled();
  });
  it("addMessage null => 404", async () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue(null);
    expect((await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID))).status).toBe(404);
  });
  it("buyer message sets lastContactDate to today", async () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue({ id: "m2", leadId: ID, from: "buyer", text: "x", at: "t" });
    const r = await messagesPOST(req("POST", { from: "buyer", text: " x " }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.addMessage).toHaveBeenCalledWith(expect.anything(), ID, "buyer", "x");
    expect(m.beginAnalysis.mock.calls[0][4]).toBe(todayIST());
  });
  it("rep message leaves lastContactDate unchanged", async () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue({ id: "m2", leadId: ID, from: "rep", text: "x", at: "t" });
    await messagesPOST(req("POST", { from: "rep", text: "x" }), ctx(ID));
    expect(m.beginAnalysis.mock.calls[0][4]).toBeUndefined();
  });
});

describe("POST sent", () => {
  it("blank draft => 400, nothing written", async () => {
    const r = await sentPOST(req("POST", { draft: "  " }), ctx(ID));
    expect(r.status).toBe(400);
    expect(m.addMessage).not.toHaveBeenCalled();
  });
  it("lead not found => 404, nothing written", async () => {
    m.getLead.mockResolvedValue(null);
    const r = await sentPOST(req("POST", { draft: "hi" }), ctx(ID));
    expect(r.status).toBe(404);
    expect(m.addMessage).not.toHaveBeenCalled();
  });
  it("malformed JSON => 400", async () => {
    const r = await sentPOST(req("POST", "{"), ctx(ID));
    expect(r.status).toBe(400);
  });
  it("happy path: addMessage -> provisional write -> response, then model -> final write", async () => {
    const order: string[] = [];
    m.getLead.mockImplementationOnce(async () => { order.push("getLead"); return chat(); });
    const added = { id: "m", leadId: ID, from: "rep" as const, text: "hello", at: "2026-10-29T00:00:00Z" };
    m.addMessage.mockImplementation(async () => { order.push("addMessage"); return added; });
    m.beginAnalysis.mockImplementation(async (_sb, _id, p, startedAt) => {
      order.push("begin");
      return { kind: "ok", lead: pendingLead(p, startedAt) };
    });
    agent.mockImplementation(async () => { order.push("analyze"); return result; });
    m.finishAnalysis.mockImplementation(async () => { order.push("finish"); return true; });
    const r = await sentPOST(req("POST", { draft: " hello " }), ctx(ID));
    expect(r.status).toBe(200);
    // The model has not run when the response is returned.
    expect(order).toEqual(["getLead", "addMessage", "begin"]);
    expect(agent).not.toHaveBeenCalled();
    expect(m.addMessage).toHaveBeenCalledWith(expect.anything(), ID, "rep", "hello");
    const body = await r.json();
    expect(body.lead.analysisStatus).toBe("pending");
    expect(body.messages).toEqual([...chat().messages, added]);
    // Provisional values come from the rules, never from the model.
    const [, , prov, startedAt, lastContact] = m.beginAnalysis.mock.calls[0];
    expect(prov.analysisSource).toBe("fallback");
    expect(lastContact).toBe(todayIST());
    expect(body.lead.analysisStartedAt).toBe(startedAt);
    await flush();
    expect(order).toEqual(["getLead", "addMessage", "begin", "analyze", "finish"]);
    expect(agent.mock.calls[0][0].messages).toEqual([
      { from: "rep", text: "hi", at: "2026-10-02T00:00:00Z" },
      { from: "rep", text: "hello", at: "2026-10-29T00:00:00Z" },
    ]);
    expect(m.finishAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, startedAt);
  });
  it("fallback analysis is still written as the final result", async () => {
    const fb = { ...result, analysisSource: "fallback" as const };
    agent.mockResolvedValue(fb);
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue({ id: "m", leadId: ID, from: "rep", text: "hi", at: "t" });
    const r = await sentPOST(req("POST", { draft: "hello" }), ctx(ID));
    expect(r.status).toBe(200);
    await flush();
    expect(m.finishAnalysis).toHaveBeenCalledWith(expect.anything(), ID, fb, expect.any(String));
  });
});

describe("fast path", () => {
  const setup = () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue({ id: "m2", leadId: ID, from: "buyer", text: "x", at: "t" });
  };
  it("responds without waiting for a model that never answers", async () => {
    setup();
    agent.mockImplementation(() => new Promise(() => {}));
    const r = await messagesPOST(req("POST", { from: "buyer", text: "price?" }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.finishAnalysis).not.toHaveBeenCalled();
    expect(afterJobs).toHaveLength(1);
  });
  it("does not re-read the chat after writing (one read, one insert, one update)", async () => {
    setup();
    await messagesPOST(req("POST", { from: "buyer", text: "price?" }), ctx(ID));
    expect(m.getLead).toHaveBeenCalledTimes(1);
    expect(m.addMessage).toHaveBeenCalledTimes(1);
    expect(m.beginAnalysis).toHaveBeenCalledTimes(1);
    await flush();
    expect(m.getLead).toHaveBeenCalledTimes(1);
  });
  it("sends the insert and the provisional write together (two round trips, not three)", async () => {
    m.getLead.mockResolvedValue(chat());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    m.addMessage.mockImplementation(async () => {
      await gate;
      return { id: "m2", leadId: ID, from: "buyer", text: "x", at: "t" };
    });
    const pending = messagesPOST(req("POST", { from: "buyer", text: "price?" }), ctx(ID));
    await vi.waitFor(() => expect(m.beginAnalysis).toHaveBeenCalledTimes(1));
    // beginAnalysis started while the insert was still in flight.
    release();
    expect((await pending).status).toBe(200);
  });
  it("provisional result already accounts for the new message", async () => {
    setup();
    await messagesPOST(req("POST", { from: "buyer", text: "please share the price quote today" }), ctx(ID));
    const prov = m.beginAnalysis.mock.calls[0][2];
    expect(prov.analysisSource).toBe("fallback");
    await flush();
    // The model gets the stored message (server timestamp), not the local stand-in.
    expect(agent.mock.calls[0][0].messages.at(-1)).toEqual({ from: "buyer", text: "x", at: "t" });
  });
  it("insert fails after the provisional write => error, lead marked ready, no background job", async () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockRejectedValue(new Error("fetch failed"));
    const r = await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    expect(r.status).toBe(503);
    expect(m.markReady).toHaveBeenCalledTimes(1);
    expect(m.markReady.mock.calls[0][2]).toBe(m.beginAnalysis.mock.calls[0][3]);
    expect(afterJobs).toHaveLength(0);
  });
  it("lead deleted mid-request (insert returns null) => 404, lead marked ready", async () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue(null);
    const r = await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    expect(r.status).toBe(404);
    expect(m.markReady).toHaveBeenCalledTimes(1);
    expect(afterJobs).toHaveLength(0);
  });
  it("provisional write fails => error, no background job", async () => {
    setup();
    m.beginAnalysis.mockRejectedValue(new Error("fetch failed"));
    const r = await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    expect(r.status).toBe(503);
    expect(m.markReady).not.toHaveBeenCalled();
    expect(afterJobs).toHaveLength(0);
  });
  it("beginAnalysis not-found => 404 and no background job", async () => {
    setup();
    m.beginAnalysis.mockResolvedValue({ kind: "not-found" });
    expect((await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID))).status).toBe(404);
    expect(afterJobs).toHaveLength(0);
  });
  it("database without the analysis columns: analyses before replying, no background job", async () => {
    setup();
    m.beginAnalysis.mockResolvedValue({ kind: "legacy" });
    m.saveAnalysis.mockResolvedValue(true);
    const r = await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    expect(r.status).toBe(200);
    expect(agent).toHaveBeenCalledTimes(1);
    expect(m.saveAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, todayIST());
    expect(afterJobs).toHaveLength(0);
    expect(m.finishAnalysis).not.toHaveBeenCalled();
  });
  it("a model that throws still ends ready, with the rule-based result", async () => {
    setup();
    agent.mockRejectedValue(new Error("boom"));
    await messagesPOST(req("POST", { from: "buyer", text: "what is the price" }), ctx(ID));
    await flush();
    const written = m.finishAnalysis.mock.calls[0][2];
    expect(written.analysisSource).toBe("fallback");
    expect(written.draft.length).toBeGreaterThan(0);
  });
  it("a failed final write is retried once, then the lead is at least marked ready", async () => {
    setup();
    m.finishAnalysis.mockRejectedValue(new Error("fetch failed"));
    await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    await flush();
    expect(m.finishAnalysis).toHaveBeenCalledTimes(2);
    expect(m.markReady).toHaveBeenCalledTimes(1);
  });
  it("never throws out of the background job, even if markReady also fails", async () => {
    setup();
    m.finishAnalysis.mockRejectedValue(new Error("fetch failed"));
    m.markReady.mockRejectedValue(new Error("fetch failed"));
    await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    await expect(flush()).resolves.toBeUndefined();
  });
  it("a retried duplicate still starts an analysis", async () => {
    m.getLead.mockResolvedValue({ ...chat(), messages: [{ id: "m1", leadId: ID, from: "buyer", text: "x", at: "2026-10-03T00:00:00Z" }] });
    await messagesPOST(req("POST", { from: "buyer", text: "x" }), ctx(ID));
    expect(m.addMessage).not.toHaveBeenCalled();
    expect(afterJobs).toHaveLength(1);
  });
});

describe("PUT draft", () => {
  it("saves", async () => {
    m.saveDraft.mockResolvedValue(true);
    const r = await draftPUT(req("PUT", { draft: "hello" }), ctx(ID));
    expect(await r.json()).toEqual({ ok: true });
  });
  it("false => 404", async () => {
    m.saveDraft.mockResolvedValue(false);
    expect((await draftPUT(req("PUT", { draft: "hello" }), ctx(ID))).status).toBe(404);
  });
  it("blank draft => 400", async () => {
    expect((await draftPUT(req("PUT", { draft: " " }), ctx(ID))).status).toBe(400);
    expect(m.saveDraft).not.toHaveBeenCalled();
  });
});

describe("GET /api/reps", () => {
  it("returns { reps: { id, name }[] }", async () => {
    const reps = [{ id: OTHER, name: "Amit" }, rep];
    m.listReps.mockResolvedValue(reps);
    const r = await repsGET(req("GET"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ reps });
    expect(m.listReps).toHaveBeenCalledTimes(1);
  });
});

describe("error mapping", () => {
  it("fetch failed => 503 with exact message", async () => {
    m.listLeads.mockRejectedValue(new TypeError("fetch failed"));
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Database unavailable, try again in a minute" });
  });
  it("reps network failure => 503", async () => {
    m.listReps.mockRejectedValue(new Error("fetch failed"));
    expect((await repsGET(req("GET"))).status).toBe(503);
  });
  it("unknown error => 500 without leaking", async () => {
    m.listReps.mockRejectedValue(new Error("secret internals"));
    const r = await repsGET(req("GET"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Something went wrong" });
  });
});

describe("retry guard (no duplicate message)", () => {
  const msg = (from: "rep" | "buyer", text: string): Message => ({ id: "x", leadId: ID, from, text, at: "2026-10-03T00:00:00Z" });
  const withLatest = (from: "rep" | "buyer", text: string) => {
    const c = { ...chat(), messages: [...chat().messages] as Message[] };
    c.messages.push(msg(from, text));
    m.getLead.mockResolvedValue(c);
    m.addMessage.mockResolvedValue(msg("rep", "n"));
    return c;
  };

  it("/sent: latest is identical rep message => no addMessage, still analyses and saves", async () => {
    const c = withLatest("rep", "Hi");
    const r = await sentPOST(req("POST", { draft: "Hi" }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.addMessage).not.toHaveBeenCalled();
    expect(m.beginAnalysis).toHaveBeenCalled();
    await flush();
    expect(agent).toHaveBeenCalled();
    expect(m.finishAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, expect.any(String));
    expect((await r.json()).messages).toEqual(c.messages);
  });
  it("/sent: same text from the buyer still adds", async () => {
    withLatest("buyer", "Hi");
    await sentPOST(req("POST", { draft: "Hi" }), ctx(ID));
    expect(m.addMessage).toHaveBeenCalledTimes(1);
  });
  it("/sent: differing latest rep message still adds", async () => {
    withLatest("rep", "Other");
    await sentPOST(req("POST", { draft: "Hi" }), ctx(ID));
    expect(m.addMessage).toHaveBeenCalledTimes(1);
  });
  it("/sent: whitespace is ignored", async () => {
    withLatest("rep", "Hi");
    await sentPOST(req("POST", { draft: "  Hi  " }), ctx(ID));
    expect(m.addMessage).not.toHaveBeenCalled();
  });
  it("/messages: same from+text as latest => no addMessage, analysis still runs", async () => {
    withLatest("buyer", "Price?");
    const r = await messagesPOST(req("POST", { from: "buyer", text: " Price? " }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.addMessage).not.toHaveBeenCalled();
    await flush();
    expect(agent).toHaveBeenCalled();
    expect(m.finishAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, expect.any(String));
  });
  it("/messages: same text, different from => adds", async () => {
    withLatest("buyer", "Price?");
    await messagesPOST(req("POST", { from: "rep", text: "Price?" }), ctx(ID));
    expect(m.addMessage).toHaveBeenCalledTimes(1);
  });
});
