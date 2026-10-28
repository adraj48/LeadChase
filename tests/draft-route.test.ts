import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(() => ({})) }));
vi.mock("@/lib/repo", () => ({
  getLead: vi.fn(),
  // Every write helper is listed so a stray call would be visible below.
  createLead: vi.fn(),
  addMessage: vi.fn(),
  saveAnalysis: vi.fn(),
  saveDraft: vi.fn(),
  beginAnalysis: vi.fn(),
  finishAnalysis: vi.fn(),
  markReady: vi.fn(),
}));

import * as repo from "@/lib/repo";
import { POST } from "@/app/api/leads/[id]/draft-suggestion/route";
import * as route from "@/app/api/leads/[id]/draft-suggestion/route";

const m = vi.mocked(repo);
const ID = "11111111-1111-4111-8111-111111111111";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
// The limiter is keyed by client IP and lives for the whole file, so every test gets
// its own address (the draft cost of one test must not leak into the next).
let ipN = 0;
let ip = "";
const nextIp = () => `203.0.113.${++ipN}`;
const lead = {
  id: ID, repId: "r1", repName: "Sneha Iyer", name: "Ravi Sharma", company: "Sharma Foods", phone: "+91 98765 43210",
  source: "IndiaMART", lastContactDate: "2026-10-27", tag: "Hot" as const, reason: "Asked for quote",
  followUpDate: "2026-10-30", draft: "old draft", analysisSource: "llm" as const,
};
const messages = [{ id: "m1", leadId: ID, from: "buyer" as const, text: "Please share quote for 2 machines", at: "2026-10-28T10:00:00Z" }];

// No cookie or auth header: there is no login.
const post = (body?: unknown, signal?: AbortSignal, forwardedFor: string | null = ip) =>
  new Request("http://t/api/leads/x/draft-suggestion", {
    method: "POST",
    headers: { "content-type": "application/json", ...(forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
const ev = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
function sseResponse(parts: string[], opts: { hang?: boolean; signal?: AbortSignal } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(c) {
        if (i < parts.length) return void c.enqueue(enc.encode(ev(parts[i++])));
        if (opts.hang) {
          await new Promise<void>((_r, rej) => opts.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
          return;
        }
        c.close();
      },
    }),
    { status: 200 },
  );
}
const noWrites = () => {
  for (const fn of [m.createLead, m.addMessage, m.saveAnalysis, m.saveDraft, m.beginAnalysis, m.finishAnalysis, m.markReady]) {
    expect(fn).not.toHaveBeenCalled();
  }
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("GEMINI_API_KEY", "test-secret-key");
  ip = nextIp();
  m.getLead.mockResolvedValue({ lead, messages });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("route config", () => {
  it("is dynamic with a 60 s budget", () => {
    expect(route.maxDuration).toBe(60);
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("no login and lead lookup", () => {
  it("works without any session cookie or auth header", async () => {
    fetchMock.mockResolvedValue(sseResponse(["Hi Ravi, quote bhej diya hai, dekhiye."]));
    const r = await POST(post(), ctx());
    expect(r.status).toBe(200);
    expect(m.getLead).toHaveBeenCalledTimes(1);
    expect(m.getLead.mock.calls[0][1]).toBe(ID);
  });
  it("404 for a missing lead and for a bad id, with no model call", async () => {
    m.getLead.mockResolvedValue(null);
    const r = await POST(post(), ctx());
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Lead not found" });
    const bad = await POST(post(), ctx("nope"));
    expect(bad.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the lead's rep first name in the prompt, and a neutral name without one", async () => {
    m.getLead.mockResolvedValue({ lead: { ...lead, repName: "" }, messages });
    fetchMock.mockResolvedValue(sseResponse(["Hi Ravi, quote bhej diya hai, dekhiye."]));
    await (await POST(post(), ctx())).text();
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain("Rep: the rep");
    expect(body).not.toContain("Sneha");
  });
});

describe("rate limit", () => {
  const draftOk = () => sseResponse(["Hi Ravi, quote bhej diya hai, dekhiye."]);
  it("429 with the project's error shape after 10 drafts in a minute, per client IP", async () => {
    fetchMock.mockImplementation(async () => draftOk());
    for (let i = 0; i < 10; i++) {
      const ok = await POST(post(), ctx());
      expect(ok.status).toBe(200);
      await ok.text();
    }
    const limited = await POST(post(), ctx());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many requests, try again in a minute" });
    // Another client is not affected.
    expect((await POST(post(undefined, undefined, nextIp()), ctx())).status).toBe(200);
  });
  it("keys on the first x-forwarded-for hop only", async () => {
    fetchMock.mockImplementation(async () => draftOk());
    const client = nextIp();
    for (let i = 0; i < 10; i++) await (await POST(post(undefined, undefined, `${client}, 10.0.0.${i}`), ctx())).text();
    expect((await POST(post(undefined, undefined, `${client}, 10.9.9.9`), ctx())).status).toBe(429);
    expect((await POST(post(undefined, undefined, `${nextIp()}, ${client}`), ctx())).status).toBe(200);
  });
  it("requests without x-forwarded-for share one fallback bucket", async () => {
    fetchMock.mockImplementation(async () => draftOk());
    for (let i = 0; i < 10; i++) await (await POST(post(undefined, undefined, null), ctx())).text();
    expect((await POST(post(undefined, undefined, null), ctx())).status).toBe(429);
    expect((await POST(post(), ctx())).status).toBe(200);
  });
  it("is checked before the lead is read", async () => {
    fetchMock.mockImplementation(async () => draftOk());
    for (let i = 0; i < 10; i++) await (await POST(post(), ctx())).text();
    m.getLead.mockClear();
    expect((await POST(post(), ctx())).status).toBe(429);
    expect(m.getLead).not.toHaveBeenCalled();
  });
  it("an automatic rewrite costs half a draft", async () => {
    fetchMock.mockImplementation(async () => draftOk());
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const r = await POST(post({ repair: ["Mentions Rs 70,000, which isn't in this chat"] }), ctx());
      if (r.status === 200) ok++;
      await r.text();
    }
    expect(ok).toBe(20);
  });
});

describe("streaming", () => {
  it("streams only the message text, in order, with the right headers", async () => {
    fetchMock.mockResolvedValue(sseResponse(["Hi Ravi, ", "2 machine ka ", "quote bhej diya hai, dekhiye."]));
    const r = await POST(post(), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("X-Accel-Buffering")).toBe("no");
    expect(r.headers.get("X-Draft-Source")).toBe("llm");
    expect(await r.text()).toBe("Hi Ravi, 2 machine ka quote bhej diya hai, dekhiye.");
    noWrites();
  });
  it("chunks arrive incrementally, not buffered to the end", async () => {
    fetchMock.mockResolvedValue(sseResponse(["Hi Ravi, here is the first part of the reply. ", "And then the second part comes later."]));
    const r = await POST(post(), ctx());
    const reader = r.body!.getReader();
    const a = await reader.read();
    expect(a.done).toBe(false);
    expect(new TextDecoder().decode(a.value).length).toBeGreaterThan(0);
    let rest = "";
    for (let x = await reader.read(); !x.done; x = await reader.read()) rest += new TextDecoder().decode(x.value);
    expect(new TextDecoder().decode(a.value) + rest).toBe("Hi Ravi, here is the first part of the reply. And then the second part comes later.");
  });
  it("sends the model the lead, chat and fact sheet, never the phone number or the key", async () => {
    fetchMock.mockResolvedValue(sseResponse(["Hi Ravi, quote bhej diya hai, dekhiye."]));
    await (await POST(post(), ctx())).text();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain(":streamGenerateContent?alt=sse");
    const body = init.body as string;
    expect(body).toContain("Please share quote for 2 machines");
    expect(body).toContain("FACT SHEET");
    expect(body).toContain("You are Sneha, a sales rep");
    expect(body).not.toContain("98765");
    expect(body).not.toContain("test-secret-key");
    expect(init.headers["x-goog-api-key"]).toBe("test-secret-key");
  });
  it("sanitizes fences, labels and quotes", async () => {
    fetchMock.mockResolvedValue(sseResponse(["```\nDraft: \"Hi Ravi, quote bhej diya hai, dekhiye.", '"\n```']));
    expect(await (await POST(post(), ctx())).text()).toBe("Hi Ravi, quote bhej diya hai, dekhiye.");
  });
  it("passes valid repair hints to the model and rejects malformed ones", async () => {
    fetchMock.mockResolvedValue(sseResponse(["Hi Ravi, quote bhej diya hai, dekhiye."]));
    await (await POST(post({ repair: ["Mentions 8%, which isn't in this chat"] }), ctx())).text();
    expect((fetchMock.mock.calls[0][1] as RequestInit).body as string).toContain("- Mentions 8%, which isn't in this chat");
    for (const bad of [{ repair: "x" }, { repair: [1] }, { repair: Array(7).fill("p") }, { repair: ["p".repeat(300)] }]) {
      const r = await POST(post(bad), ctx());
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "Invalid repair hints" });
    }
    expect(await (await POST(post({}), ctx())).text()).toContain("Hi Ravi");
  });
});

describe("fallback", () => {
  it("key missing: streams the rule-based draft with X-Draft-Source: fallback and never calls Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const r = await POST(post(), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Draft-Source")).toBe("fallback");
    expect(await r.text()).toContain("Please share quote for 2 machines");
    expect(fetchMock).not.toHaveBeenCalled();
    noWrites();
  });
  it("Gemini error: falls back instead of failing the request", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    const r = await POST(post(), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Draft-Source")).toBe("fallback");
    expect((await r.text()).length).toBeGreaterThan(10);
  });
  it("Gemini network failure, empty or blocked output: falls back", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await POST(post(), ctx())).headers.get("X-Draft-Source")).toBe("fallback");
    fetchMock.mockResolvedValueOnce(sseResponse([]));
    expect((await POST(post(), ctx())).headers.get("X-Draft-Source")).toBe("fallback");
    fetchMock.mockResolvedValueOnce(
      new Response(`data: ${JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })}\n\n`, { status: 200 }),
    );
    expect((await POST(post(), ctx())).headers.get("X-Draft-Source")).toBe("fallback");
  });
  it("never logs the key", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const spy = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    await (await POST(post(), ctx())).text();
    expect(JSON.stringify([spy.mock.calls, warn.mock.calls])).not.toContain("test-secret-key");
  });
});

describe("abort", () => {
  it("aborting the request cancels the upstream Gemini call", async () => {
    const client = new AbortController();
    let upstream: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      upstream = init.signal as AbortSignal;
      return sseResponse(["Hi Ravi, this is the start of a long reply that goes on "], { hang: true, signal: upstream });
    });
    const r = await POST(post(undefined, client.signal), ctx());
    const reader = r.body!.getReader();
    await reader.read();
    expect(upstream!.aborted).toBe(false);
    client.abort();
    expect(upstream!.aborted).toBe(true);
    expect((await reader.read()).done).toBe(true);
    noWrites();
  });
});
