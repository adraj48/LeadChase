import { buildDraftPrompt, DRAFT_GENERATION_CONFIG, type DraftPromptInput } from "@/lib/draft-prompt";
import { fallbackAnalysis, geminiModel, type AgentInput } from "@/lib/agent";

// Server-only module (reads GEMINI_API_KEY). Do not import from client code.

export const DRAFT_MAX_CHARS = 700;
/** Give up on the model (and use the rule-based draft) if no text arrives in this time. */
export const FIRST_TOKEN_TIMEOUT_MS = 12_000;
/** Hard ceiling for the whole generation. Text already sent is kept. */
export const TOTAL_TIMEOUT_MS = 30_000;

// ---------- output sanitizer ----------

const HEAD_WINDOW = 32; // characters held back until a label / fence / quote can be judged
const TAIL_HOLD = 8; // characters held back so a closing quote or fence can be dropped

const OPEN_QUOTES = /^["“]/;
const CLOSE_QUOTES = /["”]+$/;
const FENCE_OPEN = /^```[a-z]*[ \t]*\r?\n?/i;
const FENCE_CLOSE = /\r?\n?```[ \t]*$/;
const LABEL = /^(?:\*\*|__)?(?:draft|message|reply|whatsapp(?: message| reply)?|follow-?up(?: message)?)\s*:(?:\*\*|__)?\s*/i;

/**
 * Incremental clean-up of streamed model text: trims, strips a wrapping code fence,
 * a leading "Draft:" / "Message:" label and wrapping quotes, and hard-caps the length.
 * push() returns the text that is safe to send now; end() returns the remainder.
 */
export class DraftSanitizer {
  private raw = "";
  private headDone = false;
  private openedQuote = false;
  private fenced = false;
  private emitted = 0;
  capped = false;

  constructor(private readonly max = DRAFT_MAX_CHARS) {}

  push(chunk: string): string {
    if (this.capped) return "";
    this.raw += chunk;
    if (!this.headDone) {
      if (this.raw.length < HEAD_WINDOW) return "";
      this.stripHead();
    }
    return this.release(false);
  }

  end(): string {
    if (this.capped) return "";
    if (!this.headDone) this.stripHead();
    return this.release(true);
  }

  private stripHead(): void {
    let t = this.raw.replace(/^\s+/, "");
    if (FENCE_OPEN.test(t)) {
      t = t.replace(FENCE_OPEN, "");
      this.fenced = true;
    }
    t = t.replace(LABEL, "");
    if (OPEN_QUOTES.test(t)) {
      t = t.slice(1);
      this.openedQuote = true;
    }
    this.raw = t.replace(/^\s+/, "");
    this.headDone = true;
  }

  private release(final: boolean): string {
    let out: string;
    if (final) {
      let t = this.raw.replace(/\s+$/, "");
      if (this.fenced || /```$/.test(t)) t = t.replace(FENCE_CLOSE, "").replace(/\s+$/, "");
      if (this.openedQuote) t = t.replace(CLOSE_QUOTES, "").replace(/\s+$/, "");
      out = t;
      this.raw = "";
    } else {
      const body = this.raw.replace(/\s+$/, "");
      const cut = Math.max(0, body.length - TAIL_HOLD);
      out = this.raw.slice(0, cut);
      this.raw = this.raw.slice(cut);
    }
    const room = this.max - this.emitted;
    if (out.length > room) {
      out = out.slice(0, room);
      this.capped = true;
      out = out.replace(/\s+$/, "");
    }
    this.emitted += out.length;
    return out;
  }
}

/** One-shot version for whole strings (tests and the fallback path). */
export function sanitizeDraft(text: string, max = DRAFT_MAX_CHARS): string {
  const s = new DraftSanitizer(max);
  return s.push(text) + s.end();
}

// ---------- Gemini SSE parsing ----------

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Pulls the text out of Server-Sent-Events lines ("data: {json}") across chunk borders. */
export class SseTextParser {
  private buf = "";

  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      out += this.line(line);
    }
    return out;
  }

  flush(): string {
    const line = this.buf.replace(/\r$/, "");
    this.buf = "";
    return this.line(line);
  }

  private line(line: string): string {
    if (!line.startsWith("data:")) return "";
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return "";
    let obj: GeminiChunk;
    try {
      obj = JSON.parse(payload) as GeminiChunk;
    } catch {
      return "";
    }
    // A blocked prompt or answer carries no text, so it ends up on the fallback path.
    const cand = obj.candidates?.[0];
    return (cand?.content?.parts ?? []).map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  }
}

// ---------- the streaming call ----------

export interface DraftStream {
  stream: ReadableStream<Uint8Array>;
  source: "llm" | "fallback";
}

const enc = new TextEncoder();

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

export function fallbackDraftStream(input: AgentInput): DraftStream {
  return { stream: textStream(sanitizeDraft(fallbackAnalysis(input).draft)), source: "fallback" };
}

/**
 * Calls Gemini's streamGenerateContent and returns the message text as a byte stream.
 * Resolves only once the first text has arrived (so the caller can set the
 * X-Draft-Source header truthfully). Any failure before that point (no key, HTTP
 * error, timeout, blocked or empty output) yields the rule-based draft instead.
 * `signal` is the client's request signal: aborting it cancels the upstream request.
 * Never logs the key or request headers.
 */
export async function streamDraft(
  prompt: DraftPromptInput,
  fallbackInput: AgentInput,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<DraftStream> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallbackDraftStream(fallbackInput);

  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort();
  if (signal?.aborted) upstream.abort();
  else signal?.addEventListener("abort", onClientAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => upstream.abort(), FIRST_TOKEN_TIMEOUT_MS);
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    signal?.removeEventListener("abort", onClientAbort);
  };

  const { systemInstruction, userContent } = buildDraftPrompt(prompt);
  const sse = new SseTextParser();
  const clean = new DraftSanitizer();
  const dec = new TextDecoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  // Reads upstream until some sanitized text is available (or the stream ends).
  const next = async (): Promise<{ text: string; done: boolean }> => {
    for (;;) {
      if (clean.capped) return { text: "", done: true };
      const { value, done } = await reader!.read();
      if (done) {
        const tail = sse.flush();
        const text = (tail ? clean.push(tail) : "") + clean.end();
        return { text, done: true };
      }
      const text = clean.push(sse.push(dec.decode(value, { stream: true })));
      if (text) return { text, done: false };
    }
  };

  try {
    const model = geminiModel();
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: DRAFT_GENERATION_CONFIG,
        }),
        signal: upstream.signal,
      },
    );
    if (!res.ok || !res.body) {
      cleanup();
      await res.body?.cancel().catch(() => {});
      return fallbackDraftStream(fallbackInput);
    }
    reader = res.body.getReader();
    const first = await next();
    if (!first.text.trim()) {
      cleanup();
      upstream.abort();
      return fallbackDraftStream(fallbackInput);
    }

    // First text is in: replace the first-token timer with the overall ceiling.
    clearTimeout(timer);
    timer = setTimeout(() => upstream.abort(), TOTAL_TIMEOUT_MS);
    const r = reader;
    let finished = first.done;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(first.text));
        if (finished) {
          cleanup();
          c.close();
        }
      },
      async pull(c) {
        if (finished) return;
        try {
          // Loop until at least one chunk is queued, so pull() never spins without output.
          for (;;) {
            const n = await next();
            if (n.text) c.enqueue(enc.encode(n.text));
            if (n.done) {
              finished = true;
              cleanup();
              if (n.text === "" && clean.capped) upstream.abort();
              c.close();
              return;
            }
            if (n.text) return;
          }
        } catch {
          // Timeout, upstream error or client abort mid-stream: keep what was sent.
          finished = true;
          cleanup();
          try {
            c.close();
          } catch {
            // already closed or cancelled
          }
        }
      },
      cancel() {
        finished = true;
        cleanup();
        upstream.abort();
        r.cancel().catch(() => {});
      },
    });
    return { stream, source: "llm" };
  } catch {
    // Network error, timeout before the first token, or client abort.
    cleanup();
    upstream.abort();
    reader?.cancel().catch(() => {});
    return fallbackDraftStream(fallbackInput);
  }
}
