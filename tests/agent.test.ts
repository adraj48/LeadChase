import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeLead,
  clampDays,
  fallbackAnalysis,
  parseAgentJson,
  type AgentInput,
} from "@/lib/agent";
import { addDays } from "@/lib/dates";

const TODAY = "2026-10-28";

function input(over: Partial<AgentInput> = {}): AgentInput {
  return {
    lead: { name: "Ravi Sharma", company: "Sharma Foods", source: "IndiaMART", lastContactDate: addDays(TODAY, -2) },
    messages: [
      { from: "rep", text: "Sending brochure of the sealer", at: "2026-10-25T10:00:00Z" },
      { from: "buyer", text: "Please share quote for 2 machines", at: "2026-10-26T10:00:00Z" },
    ],
    today: TODAY,
    ...over,
  };
}

const validJson = { tag: "Hot", reason: "Buyer asked for quote", followUpInDays: 5, draft: "Hi Ravi, quote sent. Can we talk today?" };

function geminiResponse(text: string, status = 200) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
}

describe("parseAgentJson", () => {
  it("accepts valid JSON", () => {
    expect(parseAgentJson(JSON.stringify(validJson))).toEqual(validJson);
  });
  it("strips ```json fences", () => {
    expect(parseAgentJson("```json\n" + JSON.stringify(validJson) + "\n```")).toEqual(validJson);
  });
  it("rounds non-integer days", () => {
    expect(parseAgentJson(JSON.stringify({ ...validJson, followUpInDays: 2.6 }))?.followUpInDays).toBe(3);
  });
  it("accepts a reason longer than 200 chars", () => {
    const reason = "x".repeat(300);
    expect(parseAgentJson(JSON.stringify({ ...validJson, reason }))?.reason).toBe(reason);
  });
  it("rejects bad input", () => {
    expect(parseAgentJson("not json")).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, tag: "Lukewarm" }))).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, tag: "hot" }))).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, draft: "" }))).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, draft: "   " }))).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, reason: " " }))).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, followUpInDays: "soon" }))).toBeNull();
    expect(parseAgentJson(JSON.stringify({ ...validJson, followUpInDays: null }))).toBeNull();
    expect(parseAgentJson("null")).toBeNull();
    expect(parseAgentJson("[]")).toBeNull();
  });
});

describe("clampDays", () => {
  it("clamps per tag", () => {
    expect(clampDays("Hot", 5)).toBe(1);
    expect(clampDays("Hot", -3)).toBe(0);
    expect(clampDays("Cold", 2)).toBe(7);
    expect(clampDays("Cold", 40)).toBe(14);
    expect(clampDays("Warm", 3)).toBe(3);
    expect(clampDays("Warm", 0)).toBe(2);
  });
});

describe("fallbackAnalysis", () => {
  it("Hot for a recent quote request", () => {
    const r = fallbackAnalysis(input());
    expect(r.tag).toBe("Hot");
    expect(r.analysisSource).toBe("fallback");
    expect(r.followUpDate).toBe(addDays(TODAY, 1));
    expect(r.reason.toLowerCase()).toContain("quote");
    expect(r.draft).toContain("Ravi");
    expect(r.draft).toContain("Sharma Foods");
    expect(r.draft).not.toMatch(/\[|\{/);
  });
  it("Cold with no messages and 20 days old", () => {
    const r = fallbackAnalysis(input({ messages: [], lead: { ...input().lead, lastContactDate: addDays(TODAY, -20) } }));
    expect(r.tag).toBe("Cold");
    expect(r.followUpDate).toBe(addDays(TODAY, 7));
  });
  it("Cold with no buyer message even if recent", () => {
    const r = fallbackAnalysis(input({ messages: [{ from: "rep", text: "Hello", at: "2026-10-27T10:00:00Z" }] }));
    expect(r.tag).toBe("Cold");
  });
  it("Warm for non-keyword message 3 days old", () => {
    const r = fallbackAnalysis(
      input({
        messages: [{ from: "buyer", text: "will check with my partner", at: "2026-10-25T10:00:00Z" }],
        lead: { ...input().lead, lastContactDate: addDays(TODAY, -3) },
      }),
    );
    expect(r.tag).toBe("Warm");
    expect(r.followUpDate).toBe(addDays(TODAY, 3));
  });
  it("Warm when keyword present but contact is 10 days old", () => {
    const r = fallbackAnalysis(input({ lead: { ...input().lead, lastContactDate: addDays(TODAY, -10) } }));
    expect(r.tag).toBe("Warm");
  });
  it("uses the latest buyer message, not an earlier keyword one", () => {
    const r = fallbackAnalysis(
      input({
        messages: [
          { from: "buyer", text: "price?", at: "2026-10-20T10:00:00Z" },
          { from: "buyer", text: "let me think", at: "2026-10-26T10:00:00Z" },
        ],
      }),
    );
    expect(r.tag).toBe("Warm");
  });
  it("does not false-hit on substrings like 'border'", () => {
    const r = fallbackAnalysis(input({ messages: [{ from: "buyer", text: "we are near the border", at: "2026-10-26T10:00:00Z" }] }));
    expect(r.tag).toBe("Warm");
  });
  it("treats future lastContactDate as 0 days and handles empty name", () => {
    const r = fallbackAnalysis(input({ lead: { name: "", company: "Acme", source: "x", lastContactDate: addDays(TODAY, 3) } }));
    expect(r.tag).toBe("Hot");
    expect(r.draft).toContain("there");
    expect(r.draft).not.toMatch(/undefined|\[|\{/);
  });
});

describe("analyzeLead", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-secret-key");
    vi.stubEnv("GEMINI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns llm result with clamped follow-up date", async () => {
    const f = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(validJson)));
    const r = await analyzeLead(input(), f as unknown as typeof fetch);
    expect(r.analysisSource).toBe("llm");
    expect(r.tag).toBe("Hot");
    expect(r.followUpDate).toBe(addDays(TODAY, clampDays("Hot", 5)));
    expect(r.draft).toBe(validJson.draft);
  });

  it("sends key in header only, correct URL and body", async () => {
    const f = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(validJson)));
    await analyzeLead(input(), f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(String(url)).not.toContain("test-secret-key");
    expect(init.method).toBe("POST");
    expect(init.headers["x-goog-api-key"]).toBe("test-secret-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeDefined();
    const body = JSON.parse(init.body);
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", temperature: 0.4 });
    expect(body.systemInstruction.parts[0].text).toContain("packaging equipment");
    expect(body.systemInstruction.parts[0].text).toMatch(/Hot/);
    expect(body.contents[0].role).toBe("user");
    expect(init.body).not.toContain("test-secret-key");
  });

  it("uses GEMINI_MODEL when set", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-custom");
    const f = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(validJson)));
    await analyzeLead(input(), f as unknown as typeof fetch);
    expect(String(f.mock.calls[0][0])).toContain("models/gemini-custom:generateContent");
  });

  it("user prompt includes lead name, today and each message", async () => {
    const f = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(validJson)));
    await analyzeLead(input(), f as unknown as typeof fetch);
    const text: string = JSON.parse(f.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(text).toContain("Ravi Sharma");
    expect(text).toContain(TODAY);
    expect(text).toContain("Sending brochure of the sealer");
    expect(text).toContain("Please share quote for 2 machines");
    expect(text).toContain("[2026-10-26] Buyer: Please share quote for 2 machines");
    expect(text).toContain("[2026-10-25] Rep: Sending brochure of the sealer");
  });

  it("falls back when fetch rejects", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    expect((await analyzeLead(input(), f as unknown as typeof fetch)).analysisSource).toBe("fallback");
  });
  it("falls back on HTTP 429", async () => {
    const f = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    expect((await analyzeLead(input(), f as unknown as typeof fetch)).analysisSource).toBe("fallback");
  });
  it("falls back on invalid JSON text", async () => {
    const f = vi.fn().mockResolvedValue(geminiResponse("sorry, no json"));
    expect((await analyzeLead(input(), f as unknown as typeof fetch)).analysisSource).toBe("fallback");
  });
  it("falls back when candidates are missing", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ promptFeedback: {} }), { status: 200 }));
    expect((await analyzeLead(input(), f as unknown as typeof fetch)).analysisSource).toBe("fallback");
  });
  it("falls back without calling fetch when GEMINI_API_KEY is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const f = vi.fn();
    const r = await analyzeLead(input(), f as unknown as typeof fetch);
    expect(r.analysisSource).toBe("fallback");
    expect(f).not.toHaveBeenCalled();
  });
});
