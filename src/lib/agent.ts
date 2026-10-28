import type { Lead, Message, Tag } from "@/lib/types";
import { addDays, diffDays } from "@/lib/dates";

// Server-only module (reads GEMINI_API_KEY). Do not import from client code.
// (The `server-only` package is not installed, so no marker import is used.)

export interface AgentInput {
  lead: Pick<Lead, "name" | "company" | "source" | "lastContactDate">;
  messages: Pick<Message, "from" | "text" | "at">[];
  today: string;
}

export interface AgentResult {
  tag: Tag;
  reason: string;
  followUpDate: string;
  draft: string;
  analysisSource: "llm" | "fallback";
}

interface ParsedAgent {
  tag: Tag;
  reason: string;
  followUpInDays: number;
  draft: string;
}

const RANGES: Record<Tag, [number, number]> = {
  Hot: [0, 1],
  Warm: [2, 5],
  Cold: [7, 14],
};
const FALLBACK_DAYS: Record<Tag, number> = { Hot: 1, Warm: 3, Cold: 7 };

export function clampDays(tag: Tag, days: number): number {
  const [min, max] = RANGES[tag];
  return Math.min(max, Math.max(min, days));
}

export function parseAgentJson(raw: string): ParsedAgent | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o.tag !== "Hot" && o.tag !== "Warm" && o.tag !== "Cold") return null;
  if (typeof o.reason !== "string" || !o.reason.trim()) return null;
  if (typeof o.draft !== "string" || !o.draft.trim()) return null;
  if (typeof o.followUpInDays !== "number" || !Number.isFinite(o.followUpInDays)) return null;
  return {
    tag: o.tag,
    reason: o.reason,
    followUpInDays: Math.round(o.followUpInDays),
    draft: o.draft,
  };
}

const HOT_KEYWORDS = [
  "quote", "quotation", "price", "rate", "order", "buy",
  "invoice", "advance", "demo", "visit", "delivery",
];
// Matching choice: whole-word match on the lowercased text, allowing a simple
// inflection suffix (prices, quoted, buying, visiting). Plain substring matching
// is avoided because it false-hits ("border" -> order, "migrate" -> rate).
const HOT_REGEX = new RegExp(`\\b(?:${HOT_KEYWORDS.join("|")})(?:s|es|d|ed|ing)?\\b`, "i");

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function buildFallbackDraft(input: AgentInput, tag: Tag): string {
  const who = firstName(input.lead.name);
  const company = input.lead.company.trim();
  const at = company ? ` at ${company}` : "";
  if (tag === "Hot") {
    return `Hi ${who}, thanks for your interest${at}. Shall I share the details you asked for today? Let me know a good time to talk.`;
  }
  if (tag === "Warm") {
    return `Hi ${who}, just checking in${at}. Do you have any questions I can help with? Happy to call whenever suits you.`;
  }
  return `Hi ${who}, it has been a while since we spoke${at}. Are you still looking at packaging equipment? A quick reply would help me plan.`;
}

export function fallbackAnalysis(input: AgentInput): AgentResult {
  const { lead, messages, today } = input;
  const daysSince = Math.max(0, diffDays(today, lead.lastContactDate));
  const lastBuyer = [...messages].reverse().find((m) => m.from === "buyer");

  let tag: Tag;
  let reason: string;
  if (!lastBuyer) {
    tag = "Cold";
    reason = `No buyer reply yet, last contact ${daysSince} days ago`;
  } else if (daysSince > 14) {
    tag = "Cold";
    reason = `No buyer reply in ${daysSince} days`;
  } else {
    const hit = lastBuyer.text.toLowerCase().match(HOT_REGEX);
    if (hit && daysSince <= 7) {
      tag = "Hot";
      reason = `Buyer mentioned "${hit[0]}" ${daysSince} days ago`;
    } else {
      tag = "Warm";
      reason = `Buyer replied ${daysSince} days ago, no buying signal yet`;
    }
  }
  return {
    tag,
    reason,
    followUpDate: addDays(today, FALLBACK_DAYS[tag]),
    draft: buildFallbackDraft(input, tag),
    analysisSource: "fallback",
  };
}

function buildSystemPrompt(): string {
  return [
    "You are a sales assistant for a small Indian company selling packaging equipment to businesses.",
    "Classify the lead using this rubric:",
    "- Hot: the buyer asked about price, quote, delivery or a visit, or showed buying intent recently.",
    "- Warm: the buyer is interested but waiting on something.",
    "- Cold: no buyer reply for more than 14 days, or the buyer said explicitly \"not now\".",
    "Reply with JSON only, no other text, with exactly these keys:",
    "- tag: \"Hot\", \"Warm\" or \"Cold\"",
    "- reason: max 20 words, cite the chat",
    "- followUpInDays: number of days from today to follow up",
    "- draft: a WhatsApp message, friendly tone, max 60 words, reference the last thing discussed, one clear ask, no placeholders like [name]",
  ].join("\n");
}

function buildUserPrompt(input: AgentInput): string {
  const { lead, messages, today } = input;
  const transcript = messages
    .map((m) => `[${m.at.slice(0, 10)}] ${m.from === "rep" ? "Rep" : "Buyer"}: ${m.text}`)
    .join("\n");
  return [
    `Lead name: ${lead.name}`,
    `Company: ${lead.company}`,
    `Source: ${lead.source}`,
    `Last contact date: ${lead.lastContactDate}`,
    `Today: ${today}`,
    "",
    "Chat transcript:",
    transcript || "(no messages)",
  ].join("\n");
}

export async function analyzeLead(
  input: AgentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallbackAnalysis(input);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return fallbackAnalysis(input);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return fallbackAnalysis(input);
    const parsed = parseAgentJson(text);
    if (!parsed) return fallbackAnalysis(input);
    return {
      tag: parsed.tag,
      reason: parsed.reason,
      followUpDate: addDays(input.today, clampDays(parsed.tag, parsed.followUpInDays)),
      draft: parsed.draft,
      analysisSource: "llm",
    };
  } catch {
    // Network error, timeout or bad body: never log (request carries the API key).
    return fallbackAnalysis(input);
  }
}
