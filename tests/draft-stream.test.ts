import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftSanitizer, SseTextParser, sanitizeDraft, streamDraft } from "@/lib/draft-stream";
import { resetGeminiBreaker } from "@/lib/gemini-breaker";
import type { AgentInput } from "@/lib/agent";
import type { DraftPromptInput } from "@/lib/draft-prompt";

describe("sanitizeDraft", () => {
  it("trims", () => expect(sanitizeDraft("  \n Hello ji  \n ")).toBe("Hello ji"));
  it("strips a code fence", () => {
    expect(sanitizeDraft("```\nHi Ravi, quote bhej diya.\n```")).toBe("Hi Ravi, quote bhej diya.");
    expect(sanitizeDraft("```text\nHi Ravi, quote bhej diya.\n```")).toBe("Hi Ravi, quote bhej diya.");
  });
  it("strips a Draft: / Message: label", () => {
    expect(sanitizeDraft("Draft: Hi Ravi, are you still interested in the machine?")).toBe("Hi Ravi, are you still interested in the machine?");
    expect(sanitizeDraft("**Message:** Hi Ravi, are you still interested in the machine?")).toBe("Hi Ravi, are you still interested in the machine?");
    expect(sanitizeDraft("WhatsApp message: Hi Ravi, are you still interested in the machine?")).toBe("Hi Ravi, are you still interested in the machine?");
  });
  it("strips wrapping quotes but keeps inner ones", () => {
    expect(sanitizeDraft('"Hi Ravi, shall I call at 5 pm today?"')).toBe("Hi Ravi, shall I call at 5 pm today?");
    expect(sanitizeDraft("“Hi Ravi, shall I call at 5 pm today?”")).toBe("Hi Ravi, shall I call at 5 pm today?");
    expect(sanitizeDraft('Hi Ravi, he said "ok" to the quote, right?')).toBe('Hi Ravi, he said "ok" to the quote, right?');
  });
  it("combines fence, label and quotes", () => {
    expect(sanitizeDraft('```\nDraft: "Hi Ravi, the quote is ready for you."\n```')).toBe("Hi Ravi, the quote is ready for you.");
  });
  it("hard-caps the length", () => {
    expect(sanitizeDraft("word ".repeat(400))).toHaveLength(699);
    expect(sanitizeDraft("x".repeat(2000))).toHaveLength(700);
  });
  it("leaves short text and plain sentences alone", () => {
    expect(sanitizeDraft("Ok")).toBe("Ok");
    expect(sanitizeDraft("Draftsman needed? Hi")).toBe("Draftsman needed? Hi");
  });
});

describe("DraftSanitizer streaming", () => {
  it("gives the same result however the text is chunked", () => {
    const text = '```\nDraft: "Ji Ravi, delivery ki date confirm karke bata dete hain. Tab tak koi sawaal ho to bataiye."\n```';
    for (const size of [1, 2, 3, 7, 25, 1000]) {
      const s = new DraftSanitizer();
      let out = "";
      for (let i = 0; i < text.length; i += size) out += s.push(text.slice(i, i + size));
      out += s.end();
      expect(out, `chunk ${size}`).toBe("Ji Ravi, delivery ki date confirm karke bata dete hain. Tab tak koi sawaal ho to bataiye.");
    }
  });
  it("emits text before the end of the stream", () => {
    const s = new DraftSanitizer();
    const first = s.push("Hello Ravi, thanks for the quick reply on the quote and the details.");
    expect(first.length).toBeGreaterThan(20);
  });
  it("stops at the cap", () => {
    const s = new DraftSanitizer(50);
    const out = s.push("a".repeat(200)) + s.end();
    expect(out).toHaveLength(50);
    expect(s.capped).toBe(true);
    expect(s.push("more")).toBe("");
  });
});

describe("SseTextParser", () => {
  const ev = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
  it("extracts text across arbitrary chunk borders", () => {
    const raw = ev("Hello ") + ev("Ravi") + "data: [DONE]\n\n";
    for (const size of [1, 5, 13, 1000]) {
      const p = new SseTextParser();
      let out = "";
      for (let i = 0; i < raw.length; i += size) out += p.push(raw.slice(i, i + size));
      out += p.flush();
      expect(out, `chunk ${size}`).toBe("Hello Ravi");
    }
  });
  it("handles CRLF, junk lines and events without text", () => {
    const p = new SseTextParser();
    const raw = ": keepalive\r\n" + `data: ${JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })}\r\n\r\n` + "data: {not json\n\n" + ev("ok").replace(/\n/g, "\r\n");
    expect(p.push(raw) + p.flush()).toBe("ok");
  });
});

// ---- streamDraft with a mocked Gemini ----
const prompt: DraftPromptInput = {
  repFirstName: "Sneha",
  todayIST: "2026-10-29",
  lead: { name: "Ravi", company: "Sharma Foods", source: "IndiaMART", tag: "Hot", reason: "r", lastContactDate: "2026-10-27", followUpDate: "2026-10-30", draft: "" },
  messages: [{ from: "buyer", text: "Please share quote", at: "2026-10-28T10:00:00+05:30" }],
};
const fallbackInput: AgentInput = {
  lead: { name: "Ravi", company: "Sharma Foods", source: "IndiaMART", lastContactDate: "2026-10-27" },
  messages: [{ from: "buyer", text: "Please share quote", at: "2026-10-28T10:00:00+05:30" }],
  today: "2026-10-29",
};
const sse = (parts: string[]) => parts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`);
function sseBody(chunks: string[], opts: { hang?: boolean; signal?: AbortSignal } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i < chunks.length) {
        c.enqueue(enc.encode(chunks[i++]));
        return;
      }
      if (opts.hang) {
        await new Promise<void>((_, rej) => opts.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
        return;
      }
      c.close();
    },
  });
}
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const r = stream.getReader();
  const d = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await r.read();
    if (done) return out;
    out += d.decode(value, { stream: true });
  }
}

describe("streamDraft", () => {
  beforeEach(() => {
    resetGeminiBreaker();
    vi.stubEnv("GEMINI_API_KEY", "test-secret-key");
    vi.stubEnv("GEMINI_MODEL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("streams the model text in order and reports source llm", async () => {
    const f = vi.fn(async () => new Response(sseBody(sse(["Hi Ravi, ", "quote bhej ", "diya hai, dekh ", "lijiye aur bataiye."])), { status: 200 }));
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect(r.source).toBe("llm");
    expect(await readAll(r.stream)).toBe("Hi Ravi, quote bhej diya hai, dekh lijiye aur bataiye.");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain("models/gemini-2.5-flash:streamGenerateContent?alt=sse");
    expect(init.headers["x-goog-api-key"]).toBe("test-secret-key");
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toEqual({ temperature: 0.5, topP: 0.9, maxOutputTokens: 220, thinkingConfig: { thinkingBudget: 0 } });
    expect(body.systemInstruction.parts[0].text).toMatch(/^You are Sneha/);
    expect(body.contents[0].parts[0].text).toContain("Please share quote");
    expect(JSON.stringify(body)).not.toContain("test-secret-key");
  });
  it("after a 429 the next call goes straight to the fallback without fetching", async () => {
    let t = 5_000;
    const clock = () => t;
    const limited = vi.fn(async () => new Response("{}", { status: 429 }));
    expect((await streamDraft(prompt, fallbackInput, undefined, limited as unknown as typeof fetch, clock)).source).toBe("fallback");
    const skipped = vi.fn();
    expect((await streamDraft(prompt, fallbackInput, undefined, skipped as unknown as typeof fetch, clock)).source).toBe("fallback");
    expect(skipped).not.toHaveBeenCalled();
    t += 60_000;
    const ok = vi.fn(async () => new Response(sseBody(sse(["Hello there, this is a reply to you."])), { status: 200 }));
    expect((await streamDraft(prompt, fallbackInput, undefined, ok as unknown as typeof fetch, clock)).source).toBe("llm");
  });
  it("uses GEMINI_MODEL when set", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-custom");
    const f = vi.fn(async () => new Response(sseBody(sse(["Hello there, this is a reply to you."])), { status: 200 }));
    await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("models/gemini-custom:streamGenerateContent");
  });
  it("sanitizes fences and labels from the model output", async () => {
    const f = vi.fn(async () => new Response(sseBody(sse(["```\nDraft: ", '"Hi Ravi, quote is ready.', '"\n```'])), { status: 200 }));
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect(await readAll(r.stream)).toBe("Hi Ravi, quote is ready.");
  });
  it("falls back when the key is missing, without calling Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const f = vi.fn();
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect(f).not.toHaveBeenCalled();
    expect(r.source).toBe("fallback");
    expect(await readAll(r.stream)).toContain("Please share quote");
  });
  it.each([
    ["an HTTP error", () => new Response("{}", { status: 500 })],
    ["a rate limit", () => new Response("{}", { status: 429 })],
    ["an empty stream", () => new Response(sseBody([]), { status: 200 })],
    ["a blocked prompt", () => new Response(sseBody([`data: ${JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })}\n\n`]), { status: 200 })],
    ["blank text", () => new Response(sseBody(sse(["   ", "\n"])), { status: 200 })],
  ])("falls back on %s", async (_n, make) => {
    const f = vi.fn(async () => make());
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect(r.source).toBe("fallback");
    expect((await readAll(r.stream)).length).toBeGreaterThan(10);
  });
  it("falls back when fetch throws", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect(r.source).toBe("fallback");
  });
  it("times out waiting for the first token and falls back", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
      );
      const p = streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(12_001);
      const r = await p;
      expect(r.source).toBe("fallback");
    } finally {
      vi.useRealTimers();
    }
  });
  it("aborting the client signal cancels the upstream request", async () => {
    const client = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return new Response(sseBody(sse(["Hi Ravi, this is the start of a long reply "]), { hang: true, signal: upstreamSignal }), { status: 200 });
    });
    const r = await streamDraft(prompt, fallbackInput, client.signal, f as unknown as typeof fetch);
    expect(r.source).toBe("llm");
    const reader = r.stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("Hi Ravi");
    expect(upstreamSignal!.aborted).toBe(false);
    client.abort();
    expect(upstreamSignal!.aborted).toBe(true);
    // The stream ends cleanly with what was sent so far; it does not throw.
    const next = await reader.read();
    expect(next.done).toBe(true);
  });
  it("cancelling the response stream aborts upstream too", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return new Response(sseBody(sse(["Hi Ravi, this is the start of a long reply "]), { hang: true, signal: upstreamSignal }), { status: 200 });
    });
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    const reader = r.stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(upstreamSignal!.aborted).toBe(true);
  });
  it("an already-aborted client signal never yields a model stream", async () => {
    const c = new AbortController();
    c.abort();
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(sseBody(sse(["x"])), { status: 200 });
    });
    const r = await streamDraft(prompt, fallbackInput, c.signal, f as unknown as typeof fetch);
    expect(r.source).toBe("fallback");
  });
  it("caps the output at 700 characters and stops reading upstream", async () => {
    const f = vi.fn(async () => new Response(sseBody(sse(Array(60).fill("word ".repeat(10)))), { status: 200 }));
    const r = await streamDraft(prompt, fallbackInput, undefined, f as unknown as typeof fetch);
    expect((await readAll(r.stream)).length).toBeLessThanOrEqual(700);
  });
});
