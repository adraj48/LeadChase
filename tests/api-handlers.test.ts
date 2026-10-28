import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn(async () => ({})) }));
vi.mock("@/lib/repo", () => ({
  getCurrentRep: vi.fn(),
  listReps: vi.fn(),
  listLeads: vi.fn(),
  getLead: vi.fn(),
  createLead: vi.fn(),
  addMessage: vi.fn(),
  saveAnalysis: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock("@/lib/agent", () => ({ analyzeLead: vi.fn() }));

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
const rep = { id: "33333333-3333-4333-8333-333333333333", name: "Rep", email: "r@x.in", role: "rep" as const };
const owner = { id: "44444444-4444-4444-8444-444444444444", name: "Boss", email: "o@x.in", role: "owner" as const };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getCurrentRep.mockResolvedValue(rep);
  agent.mockResolvedValue(result);
});
afterEach(() => vi.restoreAllMocks());

describe("401 when no rep", () => {
  beforeEach(() => m.getCurrentRep.mockResolvedValue(null));
  const check = async (p: Promise<Response>) => {
    const r = await p;
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Not signed in" });
  };
  it("GET /api/leads", () => check(leadsGET(req("GET"))));
  it("POST /api/leads", () => check(leadsPOST(req("POST", {}))));
  it("GET /api/leads/[id]", () => check(leadGET(req("GET"), ctx(ID))));
  it("POST messages", () => check(messagesPOST(req("POST", { from: "rep", text: "x" }), ctx(ID))));
  it("POST sent", () => check(sentPOST(req("POST", { draft: "x" }), ctx(ID))));
  it("PUT draft", () => check(draftPUT(req("PUT", { draft: "x" }), ctx(ID))));
  it("GET /api/reps", () => check(repsGET(req("GET"))));
  it("does not touch data", async () => {
    await leadsGET(req("GET"));
    expect(m.listLeads).not.toHaveBeenCalled();
  });
});

describe("GET /api/leads", () => {
  it("returns sorted leads, today and me", async () => {
    const a = mkLead({ id: "a", followUpDate: "2099-01-01", tag: "Hot" });
    const b = mkLead({ id: "b", followUpDate: "2000-01-01", tag: "Cold" });
    m.listLeads.mockResolvedValue([a, b]);
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads"));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.today).toBe(todayIST());
    expect(j.me).toEqual(rep);
    expect(j.leads.map((l: { id: string }) => l.id)).toEqual(["b", "a"]);
  });
  it("ignores ?rep= for a rep", async () => {
    m.listLeads.mockResolvedValue([]);
    await leadsGET(req("GET", undefined, `http://t/api/leads?rep=${OTHER}`));
    expect(m.listLeads).toHaveBeenCalledTimes(1);
    expect(m.listLeads.mock.calls[0][1]).toBeUndefined();
  });
  it("honours ?rep= for the owner", async () => {
    m.getCurrentRep.mockResolvedValue(owner);
    m.listLeads.mockResolvedValue([]);
    await leadsGET(req("GET", undefined, `http://t/api/leads?rep=${OTHER}`));
    expect(m.listLeads.mock.calls[0][1]).toBe(OTHER);
  });
  it("ignores a non-uuid ?rep= for the owner", async () => {
    m.getCurrentRep.mockResolvedValue(owner);
    m.listLeads.mockResolvedValue([]);
    await leadsGET(req("GET", undefined, "http://t/api/leads?rep=nope"));
    expect(m.listLeads.mock.calls[0][1]).toBeUndefined();
  });
});

describe("POST /api/leads", () => {
  const body = { name: "A", company: "B", phone: "+911234567890", source: "Website", lastContactDate: "2026-10-01" };
  it("rep cannot choose another rep", async () => {
    m.createLead.mockResolvedValue(mkLead());
    const r = await leadsPOST(req("POST", { ...body, repId: OTHER }));
    expect(r.status).toBe(201);
    expect(m.createLead.mock.calls[0][1]).toBe(rep.id);
    expect(agent).toHaveBeenCalledWith(expect.objectContaining({ messages: [] }));
  });
  it("owner may choose a rep", async () => {
    m.getCurrentRep.mockResolvedValue(owner);
    m.createLead.mockResolvedValue(mkLead());
    await leadsPOST(req("POST", { ...body, repId: OTHER }));
    expect(m.createLead.mock.calls[0][1]).toBe(OTHER);
  });
  it("owner defaults to own id", async () => {
    m.getCurrentRep.mockResolvedValue(owner);
    m.createLead.mockResolvedValue(mkLead());
    await leadsPOST(req("POST", body));
    expect(m.createLead.mock.calls[0][1]).toBe(owner.id);
  });
  it("unknown rep FK violation => 400", async () => {
    m.getCurrentRep.mockResolvedValue(owner);
    m.createLead.mockRejectedValue(new Error("Supabase error: insert violates foreign key constraint \"leads_rep_id_fkey\""));
    const r = await leadsPOST(req("POST", { ...body, repId: OTHER }));
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
    m.saveAnalysis.mockResolvedValue(true);
    const r = await messagesPOST(req("POST", { from: "buyer", text: " x " }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.addMessage).toHaveBeenCalledWith(expect.anything(), ID, "buyer", "x");
    expect(m.saveAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, todayIST());
  });
  it("rep message leaves lastContactDate unchanged", async () => {
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue({ id: "m2", leadId: ID, from: "rep", text: "x", at: "t" });
    m.saveAnalysis.mockResolvedValue(true);
    await messagesPOST(req("POST", { from: "rep", text: "x" }), ctx(ID));
    expect(m.saveAnalysis.mock.calls[0][3]).toBeUndefined();
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
  it("happy path: addMessage -> analyzeLead -> saveAnalysis, returns re-read chat", async () => {
    const order: string[] = [];
    const after = chat({ tag: "Hot" });
    m.getLead
      .mockImplementationOnce(async () => { order.push("getLead1"); return chat(); })
      .mockImplementationOnce(async () => { order.push("getLead2"); return after; })
      .mockImplementationOnce(async () => { order.push("getLead3"); return after; });
    m.addMessage.mockImplementation(async () => { order.push("addMessage"); return { id: "m", leadId: ID, from: "rep", text: "hi", at: "t" }; });
    agent.mockImplementation(async () => { order.push("analyze"); return result; });
    m.saveAnalysis.mockImplementation(async () => { order.push("save"); return true; });
    const r = await sentPOST(req("POST", { draft: " hello " }), ctx(ID));
    expect(r.status).toBe(200);
    expect(order.indexOf("addMessage")).toBeLessThan(order.indexOf("analyze"));
    expect(order.indexOf("analyze")).toBeLessThan(order.indexOf("save"));
    expect(m.addMessage).toHaveBeenCalledWith(expect.anything(), ID, "rep", "hello");
    expect(m.saveAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, todayIST());
    expect(agent.mock.calls[0][0].messages[0]).toEqual({ from: "rep", text: "hi", at: "2026-10-02T00:00:00Z" });
    expect(await r.json()).toEqual(after);
  });
  it("fallback analysis is still saved and returned", async () => {
    const fb = { ...result, analysisSource: "fallback" as const };
    agent.mockResolvedValue(fb);
    m.getLead.mockResolvedValue(chat());
    m.addMessage.mockResolvedValue({ id: "m", leadId: ID, from: "rep", text: "hi", at: "t" });
    m.saveAnalysis.mockResolvedValue(true);
    const r = await sentPOST(req("POST", { draft: "hello" }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.saveAnalysis).toHaveBeenCalledWith(expect.anything(), ID, fb, todayIST());
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
  it("returns reps", async () => {
    m.listReps.mockResolvedValue([rep]);
    expect(await (await repsGET(req("GET"))).json()).toEqual({ reps: [rep] });
  });
});

describe("error mapping", () => {
  it("fetch failed => 503 with exact message", async () => {
    m.listLeads.mockRejectedValue(new TypeError("fetch failed"));
    const r = await leadsGET(req("GET", undefined, "http://t/api/leads"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Database unavailable, try again in a minute" });
  });
  it("getCurrentRep network failure => 503", async () => {
    m.getCurrentRep.mockRejectedValue(new Error("fetch failed"));
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
    m.saveAnalysis.mockResolvedValue(true);
    return c;
  };

  it("/sent: latest is identical rep message => no addMessage, still analyses and saves", async () => {
    const c = withLatest("rep", "Hi");
    const r = await sentPOST(req("POST", { draft: "Hi" }), ctx(ID));
    expect(r.status).toBe(200);
    expect(m.addMessage).not.toHaveBeenCalled();
    expect(agent).toHaveBeenCalled();
    expect(m.saveAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, todayIST());
    expect(await r.json()).toEqual(c);
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
    expect(agent).toHaveBeenCalled();
    expect(m.saveAnalysis).toHaveBeenCalledWith(expect.anything(), ID, result, todayIST());
  });
  it("/messages: same text, different from => adds", async () => {
    withLatest("buyer", "Price?");
    await messagesPOST(req("POST", { from: "rep", text: "Price?" }), ctx(ID));
    expect(m.addMessage).toHaveBeenCalledTimes(1);
  });
});
