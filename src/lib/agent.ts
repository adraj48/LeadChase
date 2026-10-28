import type { Lead, Message, Tag } from "@/lib/types";
import { addDays, diffDays, istDateOf } from "@/lib/dates";
import { buildContext } from "@/lib/draft-context";
import { geminiBlocked, noteGeminiStatus } from "@/lib/gemini-breaker";
import { EXAMPLES, persona, voiceRules } from "@/lib/draft-voice";

// Server-only module (reads GEMINI_API_KEY). Do not import from client code.
// (The `server-only` package is not installed, so no marker import is used.)

export interface AgentInput {
  lead: Pick<Lead, "name" | "company" | "source" | "lastContactDate">;
  messages: Pick<Message, "from" | "text" | "at">[];
  today: string;
  repName?: string;
  previousTag?: Tag;
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
  if (o.draft.length > 1000) return null;
  return {
    tag: o.tag,
    reason: o.reason.slice(0, 300),
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

// Strong buying signals: a lead whose last buyer message has one stays Hot for up to 14 days.
const STRONG_REGEX =
  /\b(?:confirm(?:ed|s)?|order(?:ed|ing)?|finali[sz]e[d]?|budget (?:is )?(?:approved|cleared)|approved|agreed?|go ahead|proceed|advance|proforma|pay(?:ment)?)\b/i;

const HINGLISH_TOKENS = new Set([
  "hai", "hain", "nahi", "nahin", "kya", "aap", "aapka", "aapki", "kab", "abhi", "kal", "bhai", "ji",
  "haan", "theek", "chahiye", "bhejo", "bhej", "karo", "kar", "hum", "main", "mujhe", "kitna", "kitne",
  "hafte", "din", "baat", "dijiye", "karna", "karenge", "milega", "ho", "tha", "thi", "se", "ko", "ka", "ki",
]);

export function isHinglish(texts: string[]): boolean {
  const words = texts.join(" ").toLowerCase().match(/[a-z]+/g) ?? [];
  let hits = 0;
  for (const w of words) if (HINGLISH_TOKENS.has(w)) hits++;
  return hits >= 2;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}...` : t;
}

function buildFallbackDraft(input: AgentInput, tag: Tag): string {
  const who = firstName(input.lead.name);
  const company = input.lead.company.trim();
  const at = company ? ` at ${company}` : "";
  const last = input.messages[input.messages.length - 1];
  const hinglish = isHinglish(input.messages.filter((m) => m.from === "buyer").map((m) => m.text));
  if (last && last.from === "buyer" && last.text.trim()) {
    const quote = snippet(last.text);
    return hinglish
      ? `Hi ${who} ji, aapne likha: "${quote}". Is baare mein details jald share ki jayengi. Call ke liye kab time theek rahega?`
      : `Hi ${who}, thanks for your message: "${quote}". I will come back to you on this shortly. When would be a good time for a quick call?`;
  }
  if (tag === "Hot") {
    return hinglish
      ? `Hi ${who} ji, aapki ruchi ke liye shukriya. Details share karne ke liye call ka koi time bata dein.`
      : `Hi ${who}, thanks for your interest${at}. Shall I share the details you asked for? Let me know a good time to talk.`;
  }
  if (tag === "Warm") {
    return hinglish
      ? `Hi ${who} ji, bas check in kar rahe the. Koi sawaal ho to bata dein, call ke liye time aap tay kar lein.`
      : `Hi ${who}, just checking in${at}. Do you have any questions I can help with? Happy to call whenever suits you.`;
  }
  return `Hi ${who}, it has been a while since we spoke${at}. Are you still looking at packaging equipment? A quick reply would help me plan.`;
}

export function fallbackAnalysis(input: AgentInput): AgentResult {
  const { lead, messages, today } = input;
  const lastBuyer = [...messages].reverse().find((m) => m.from === "buyer");
  // Day counts come from the last BUYER message; lastContactDate (which a rep send
  // bumps to today) is only the fallback when no buyer message carries a date.
  const reference = lastBuyer?.at ? istDateOf(lastBuyer.at) : lead.lastContactDate;
  const daysSince = Math.max(0, diffDays(today, reference));

  let tag: Tag;
  let reason: string;
  if (!lastBuyer) {
    tag = "Cold";
    const sinceContact = Math.max(0, diffDays(today, lead.lastContactDate));
    reason = `No buyer reply yet, last contact ${sinceContact} days ago`;
  } else if (daysSince > 14) {
    tag = "Cold";
    reason = `No buyer reply in ${daysSince} days`;
  } else {
    const hit = lastBuyer.text.toLowerCase().match(HOT_REGEX);
    const strong = lastBuyer.text.toLowerCase().match(STRONG_REGEX);
    if (hit && daysSince <= 7) {
      tag = "Hot";
      reason = `Buyer mentioned "${hit[0]}" ${daysSince} days ago`;
    } else if (strong || (hit && input.previousTag === "Hot")) {
      // Already-Hot leads (or clear buying signals) are not downgraded just because days passed.
      tag = "Hot";
      reason = `Buyer said "${(strong ?? hit)![0]}" ${daysSince} days ago, still waiting on them`;
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

function buildSystemPrompt(repName?: string): string {
  const rep = repName?.trim() || "the rep";
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
    `- draft: the next WhatsApp message ${rep} should send, written as ${rep} following the DRAFT VOICE below, max 60 words, one clear ask`,
    "The user message contains a TIMELINE, a FACT SHEET, the CHAT, a KNOWN vs UNKNOWN summary and a NEXT BEST ACTION computed from the chat. Follow the NEXT BEST ACTION for the draft unless it conflicts with the facts.",
    "",
    "DRAFT VOICE",
    persona(rep),
    voiceRules(rep),
    EXAMPLES,
  ].join("\n");
}

function buildUserPrompt(input: AgentInput, repName?: string): string {
  const { lead, messages, today } = input;
  const ctx = buildContext({
    repFirstName: repName ?? "the rep",
    lead: { name: lead.name, company: lead.company, source: lead.source, lastContactDate: lead.lastContactDate },
    messages,
    todayIST: today,
  });
  return ctx.text;
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export async function analyzeLead(
  input: AgentInput,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AgentResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || geminiBlocked(now())) return fallbackAnalysis(input);
  const model = geminiModel();
  const repFirst = input.repName ? firstName(input.repName) : undefined;
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(repFirst) }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(input, repFirst) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!res.ok) {
      noteGeminiStatus(res.status, now());
      return fallbackAnalysis(input);
    }
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
