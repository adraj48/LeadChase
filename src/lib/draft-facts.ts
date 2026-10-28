import type { Lead, Message } from "@/lib/types";
import { addDays, diffDays, istDateOf } from "@/lib/dates";
import { extractNumberTokens } from "@/lib/number-tokens";

// Grounding by construction: everything the model is allowed to treat as a fact is
// computed here, in-process, from the lead and the chat. Pure; no network.

export type Language = "english" | "hinglish" | "hindi-devanagari" | "unknown";
export type BuyerDecision =
  | "declined"
  | "later"
  | "ready-to-order"
  | "negotiating"
  | "interested"
  | "silent"
  | "new";

export interface Ref {
  /** For a relative timeframe ("after 10 days", "tomorrow"): the calendar date it points to. */
  resolved?: string;
  text: string;
  /** 1-based position in the full chat (the number printed in front of the message). */
  messageIndex: number;
}
export interface PriceRef extends Ref {
  from: "rep" | "buyer";
}

export interface FactSheet {
  buyerLastMessage: string | null; // verbatim
  whoSpokeLast: "buyer" | "rep" | null;
  daysSinceLastMessage: number | null;
  language: Language;
  prices: PriceRef[];
  quantities: Ref[];
  productsMentioned: string[];
  datesMentioned: Ref[];
  promisesByRep: Ref[];
  openBuyerQuestions: Ref[];
  buyerDecision: BuyerDecision;
  /** The buyer's last message proposed a day (tomorrow, after N days) and that day is today. */
  dueToday: boolean;
}

export interface Timeline {
  firstContact: string; // YYYY-MM-DD
  quoteMoments: { messageIndex: number; date: string; from: "rep" | "buyer" }[];
  lastBuyerDate: string | null;
  lastRepDate: string | null;
  daysSinceBuyerReplied: number | null;
  daysSinceRepWrote: number | null;
  /** Rep messages sent since the buyer last spoke (all rep messages if the buyer never did). 0 if the buyer spoke last. */
  unansweredFollowUps: number;
}

type LeadFacts = Pick<Lead, "lastContactDate">;
type Msg = Pick<Message, "from" | "text" | "at">;

// ---------- language ----------

const DEVANAGARI = /[ऀ-ॿ]/;
const HINGLISH_TOKENS = new Set([
  "hai", "hain", "nahi", "nahin", "kya", "aap", "aapka", "aapki", "aapko", "kab", "abhi", "kal", "parso", "bhai",
  "ji", "haan", "han", "theek", "thik", "chahiye", "chahie", "bhejo", "bhej", "bhejna", "karo", "hum", "mujhe",
  "kitna", "kitne", "kitni", "hafte", "din", "baat", "dijiye", "kijiye", "karna", "karenge", "karte", "milega",
  "tha", "thi", "ka", "ki", "ke", "ko", "se", "bataiye", "batao", "bata", "dekhiye", "dekh", "lagta", "lag",
  "raha", "rahi", "rahe", "hoga", "hogi", "honge", "mein", "aur", "par", "pe", "wala", "wali", "kuch", "bahut",
  "koi", "mil", "gaya", "gayi", "gaye", "lage", "lagi", "achhe", "acche", "bhejiye", "pasand", "aaye", "kiya", "kiye",
  "diya", "liya", "lena", "dena", "lekin", "magar", "tak", "sirf", "sab", "yeh", "ye", "woh", "unka", "unke", "inka",
  "apka", "aapke", "hamare", "humne", "mere", "isme", "usme", "dusre", "chalega", "karke", "karenge", "karta",
  "accha", "achha", "sahi", "zyada", "jyada", "paise", "baad", "wapas", "mera", "meri", "humein", "hamara",
]);

/** Hinglish tokens in `text`, and the word count (Roman words only). */
export function hinglishScore(text: string): { hits: number; words: number } {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let hits = 0;
  for (const w of words) if (HINGLISH_TOKENS.has(w)) hits++;
  return { hits, words: words.length };
}

export function languageOfText(text: string): Language {
  if (DEVANAGARI.test(text)) return "hindi-devanagari";
  const { hits, words } = hinglishScore(text);
  if (words === 0) return "unknown";
  if (hits >= 2 || (hits >= 1 && hits / words >= 0.3)) return "hinglish";
  return "english";
}

/** Language of the buyer's last 3 messages; the rep's if the buyer never wrote; else unknown. */
export function detectLanguage(messages: Msg[]): Language {
  const buyer = messages.filter((m) => m.from === "buyer").slice(-3);
  // The last buyer message decides on its own when it is clearly Hindi or Hinglish.
  if (buyer.length > 0) {
    const own = languageOfText(buyer[buyer.length - 1].text);
    if (own === "hinglish" || own === "hindi-devanagari") return own;
  }
  const basis = buyer.length > 0 ? buyer : messages.filter((m) => m.from === "rep").slice(-3);
  if (basis.length === 0) return "unknown";
  return languageOfText(basis.map((m) => m.text).join(" "));
}

// ---------- extractors ----------

const PRODUCTS: [string, RegExp][] = [
  ["pouch machine", /pouch/i],
  ["form-fill-seal", /form[- ]?fill[- ]?seal|\bffs\b/i],
  ["strapping", /strapping/i],
  ["shrink wrap", /shrink/i],
  ["tunnel", /\btunnel\b/i],
  ["carton sealer", /carton[- ]?seal/i],
  ["L-bar sealer", /\bl[- ]?bar\b/i],
  ["flow wrap", /flow[- ]?wrap/i],
  ["band sealer", /band[- ]?seal/i],
  ["date coder", /date[- ]?cod/i],
];

const QTY_RE =
  /\b\d[\d,]*\s*-?\s*(?:machines?|units?|pcs|pieces?|sets?|pouch(?:es)?|heads?|bundles?|rolls?|cartons?|boxes|kgs?|mm|per\s+hour|\/\s?(?:hr|hour|min)|pouch\/min)\b/gi;

const RELATIVE_DATE_RE =
  /\b(?:after|in|within)\s+\d+\s*(?:days?|din|weeks?|hafte?|months?|mahine)\b|\b\d+\s*(?:din|days?|hafte?|weeks?|mahine|months?)\s*(?:baad|later|mein|me)\b|\b(?:tomorrow|kal|parso|next\s+(?:week|month)|agle\s+(?:hafte|mahine)|month[- ]?end|this\s+(?:week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

const PROMISE_RE =
  /\bwill\s+(?:send|share|call|confirm|get back|revert|check|arrange|update|let you know)\b|\bi'?ll\s+(?:send|share|call|confirm|check|get back|revert)\b|\blet me\s+(?:check|confirm)\b|\bbhej\s*(?:raha|rahi|ta|ti|unga|ungi|doon|dete|dunga|dungi|denge|diya)?\b|\bconfirm\s+kar|\bbata\s*(?:ta|ti|unga|ungi|dunga|dungi|denge|dete|doon)\b|\bcall\s+kar(?:ta|ti|unga|ungi|enge|te)\b|\bcheck\s+kar(?:ke|ta|ti|enge|te)\b|\brevert\b|\bsending\b|\bsharing\b/i;

const QUESTION_WORD_RE =
  /\b(?:kitna|kitne|kitni|kab|kya|kaise|kahan|kaun|kyun|how much|how long|how many|when|what|which|where|can you|could you|will you|do you|is it|are you|is there)\b/i;
const TOPIC_RE = /\b(?:price|rate|quote|quotation|discount|delivery|demo|warranty|visit|video|catalog(?:ue)?|brochure)\b/i;
const REQUEST_CUE_RE = /\b(?:send|share|bhej\w*|bata\w*|dijiye|dena|de do|please|pls|need|chahiye|want|give)\b/i;

const UNIT_DAYS: Record<string, number> = { day: 1, days: 1, din: 1, week: 7, weeks: 7, hafte: 7, hafta: 7, month: 30, months: 30, mahine: 30 };

/** Calendar date a relative phrase points to, counted from the day the message was written. */
// "kal" means yesterday or tomorrow; a past-tense verb in the same message says which.
const PAST_RE = /\b(?:tha|thi|the|hua|hui|kiya|gaya|gayi|aaya|bheja|mila|dekha|bola|boli)\b/i;

export function resolveRelative(phrase: string, messageDate: string, sentence = ""): string | undefined {
  const t = phrase.toLowerCase();
  if (/^tomorrow$/.test(t)) return addDays(messageDate, 1);
  if (t === "kal") return addDays(messageDate, PAST_RE.test(sentence) ? -1 : 1);
  const m = t.match(/(\d+)\s*(days?|din|weeks?|hafte|hafta|months?|mahine)/);
  if (!m) return undefined;
  return addDays(messageDate, Number(m[1]) * (UNIT_DAYS[m[2]] ?? 1));
}

function snippet(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[?.!\n])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isQuestion(sentence: string): boolean {
  if (/\?\s*$/.test(sentence)) return true;
  if (QUESTION_WORD_RE.test(sentence)) return true;
  return TOPIC_RE.test(sentence) && REQUEST_CUE_RE.test(sentence);
}

const DECLINED_RE =
  /\bnot interested\b|\bno longer\b|\bnahi (?:chahiye|lena|karna)\b|\bnahin (?:chahiye|lena)\b|\bdon'?t need\b|\bdo not need\b|\bcancel\b|\balready (?:bought|purchased|ordered|finali[sz]ed|taken)\b|\bstop (?:messaging|calling|sending)\b|\bremove (?:me|my)\b|\bnot required\b|\bmat bhejo\b|\bband karo\b|\bwent with\b|\bbought from\b|\bnot (?:going|planning) to\b|\brequirement (?:nahi|cancel)|\bno requirement\b|\b(?:dusre|other|another) supplier\b|\b(?:le li|kharid li|kharid liya)\b/i;
const LATER_RE =
  /\bafter\s+\d+\s*(?:days?|din|weeks?|hafte?|months?|mahine)\b|\bnext\s+(?:week|month|quarter)\b|\bagle\s+(?:hafte|mahine)\b|\bcall\s+(?:me\s+)?(?:later|after)\b|\bbaad\s+(?:mein|me)\b|\babhi nahi\b|\bnot now\b|\b(?:diwali|holi|eid)\s+ke baad\b|\bmonth[- ]?end\b|\bbusy\b|\bnot this (?:year|quarter|month)\b|\bnext year\b|\b(?:revert|get back|let you know|batayenge|bata denge)\b|\bwill discuss\b|\bdiscuss (?:and|with|karke|kar ke)\b|\b(?:maybe|call|contact|talk|connect|check|reach|ping)\b[^.!?]{0,30}\bin\s+\d+\s*(?:days?|din|weeks?|hafte?|months?)\b/i;
// "Kal" is tomorrow only on the day it was said; a day later it is today, and after that it has passed.
const TOMORROW_RE = /\bkal\s+(?:baat|call|confirm|bataunga|batata|batayenge|milte)\b|\btomorrow\b/i;
const READY_RE =
  /\bconfirm(?:ed)?\b|\bgo ahead\b|\bproceed\b|\bfinali[sz]e\b|\bplace (?:the |an )?order\b|\border\s+(?:de|kar|karna|karte|dena)\b|\badvance\b|\bbank details\b|\bproforma\b|\binvoice\b|\bpayment link\b|\bready to (?:order|buy)\b|\blet'?s do it\b|\ble lete\b|\bbook kar\b|\bdone\b/i;
const NEGOTIATING_RE =
  /\bdiscount\b|\btoo (?:high|expensive|costly)\b|\bcostly\b|\bexpensive\b|\bmehn?ga\b|\bkam\s+(?:kar|karo|kijiye|karna)\b|\breduce\b|\bbest price\b|\bfinal price\b|\bcompetitor\b|\bcheaper\b|\bsasta\b|\bbudget\b|\b(?:price|rate)\s+(?:high|zyada|jyada|kam)\b|\b(?:zyada|jyada)\s+(?:lag|hai)\b|\bbol rahe the\b|\bquoted\b/i;

function buyerDecisionOf(messages: Msg[], whoSpokeLast: FactSheet["whoSpokeLast"], todayIST: string): BuyerDecision {
  if (messages.length === 0) return "new";
  const lastBuyer = [...messages].reverse().find((m) => m.from === "buyer");
  if (!lastBuyer) return "silent";
  const t = lastBuyer.text;
  if (DECLINED_RE.test(t)) return "declined";
  if (LATER_RE.test(t)) return "later";
  if (TOMORROW_RE.test(t) && diffDays(todayIST, istDateOf(lastBuyer.at)) <= 0) return "later";
  if (whoSpokeLast === "rep") return "silent";
  if (READY_RE.test(t)) return "ready-to-order";
  if (NEGOTIATING_RE.test(t)) return "negotiating";
  return "interested";
}

const PRICE_WORD_RE = /\b(?:price|rate|quote|quotation|cost|rs|rupees?|rupaye|inr|total|per (?:piece|machine|unit))\b|₹|\/-/i;

function priceTokens(text: string): string[] {
  const out: string[] = [];
  const hasPriceWord = PRICE_WORD_RE.test(text);
  for (const t of extractNumberTokens(text)) {
    if (t.kind === "money") out.push(t.text);
    else if (t.kind === "number" && t.value !== undefined) {
      const bigUnit = /\d\s*(?:lakhs?|lacs?|crores?|k|l|cr)\b/i.test(t.text);
      if (bigUnit || (hasPriceWord && t.value >= 1000)) out.push(t.text);
    }
  }
  return out;
}

function whoSpokeLastOf(messages: Msg[]): "buyer" | "rep" | null {
  return messages.length ? messages[messages.length - 1].from : null;
}

export function extractFacts(
  lead: LeadFacts,
  messages: Msg[],
  todayIST: string,
): FactSheet {
  void lead;
  const prices: PriceRef[] = [];
  const quantities: Ref[] = [];
  const datesMentioned: Ref[] = [];
  const promisesByRep: Ref[] = [];
  const products = new Set<string>();
  const seen = new Set<string>();
  const add = (list: Ref[], text: string, messageIndex: number, resolved?: string) => {
    const key = `${list === quantities ? "q" : "d"}|${messageIndex}|${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(resolved ? { text, messageIndex, resolved } : { text, messageIndex });
  };

  messages.forEach((m, i) => {
    const idx = i + 1;
    for (const p of priceTokens(m.text)) prices.push({ text: p, from: m.from, messageIndex: idx });
    for (const q of m.text.match(QTY_RE) ?? []) add(quantities, q.replace(/\s+/g, " ").trim(), idx);
    for (const t of extractNumberTokens(m.text)) if (t.kind === "date") add(datesMentioned, t.text, idx);
    for (const d of m.text.match(RELATIVE_DATE_RE) ?? []) {
      const phrase = d.replace(/\s+/g, " ").trim();
      add(datesMentioned, phrase, idx, resolveRelative(phrase, istDateOf(m.at), m.text));
    }
    for (const [name, re] of PRODUCTS) if (re.test(m.text)) products.add(name);
    if (m.from === "rep" && PROMISE_RE.test(m.text)) promisesByRep.push({ text: snippet(m.text), messageIndex: idx });
  });

  // A buyer question stays open until the rep writes anything after it.
  const lastRepIdx = messages.reduce((acc, m, i) => (m.from === "rep" ? i + 1 : acc), 0);
  const openBuyerQuestions: Ref[] = [];
  messages.forEach((m, i) => {
    if (m.from !== "buyer" || i + 1 < lastRepIdx) return;
    for (const s of sentences(m.text)) if (isQuestion(s)) openBuyerQuestions.push({ text: snippet(s, 200), messageIndex: i + 1 });
  });

  const last = messages[messages.length - 1];
  const lastBuyer = [...messages].reverse().find((m) => m.from === "buyer");
  const lastBuyerIdx = lastBuyer ? messages.lastIndexOf(lastBuyer) + 1 : -1;
  const dueToday =
    whoSpokeLastOf(messages) === "buyer" && datesMentioned.some((d) => d.messageIndex === lastBuyerIdx && d.resolved === todayIST);
  const whoSpokeLast = last ? last.from : null;
  return {
    buyerLastMessage: lastBuyer ? lastBuyer.text : null,
    whoSpokeLast,
    daysSinceLastMessage: last ? Math.max(0, diffDays(todayIST, istDateOf(last.at))) : null,
    language: detectLanguage(messages),
    prices,
    quantities,
    productsMentioned: [...products],
    datesMentioned,
    promisesByRep,
    openBuyerQuestions,
    buyerDecision: buyerDecisionOf(messages, whoSpokeLast, todayIST),
    dueToday,
  };
}

export function buildTimeline(lead: LeadFacts, messages: Msg[], todayIST: string, facts: FactSheet): Timeline {
  const dateOf = (m: Msg) => istDateOf(m.at);
  const firstContact = messages.length > 0 ? dateOf(messages[0]) : lead.lastContactDate;
  const quoteMoments = facts.prices
    .filter((p, i, a) => a.findIndex((x) => x.messageIndex === p.messageIndex) === i)
    .map((p) => ({ messageIndex: p.messageIndex, date: dateOf(messages[p.messageIndex - 1]), from: p.from }));
  const lastBuyer = [...messages].reverse().find((m) => m.from === "buyer");
  const lastRep = [...messages].reverse().find((m) => m.from === "rep");
  let unanswered = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].from === "rep"; i--) unanswered++;
  return {
    firstContact,
    quoteMoments,
    lastBuyerDate: lastBuyer ? dateOf(lastBuyer) : null,
    lastRepDate: lastRep ? dateOf(lastRep) : null,
    daysSinceBuyerReplied: lastBuyer ? Math.max(0, diffDays(todayIST, dateOf(lastBuyer))) : null,
    daysSinceRepWrote: lastRep ? Math.max(0, diffDays(todayIST, dateOf(lastRep))) : null,
    unansweredFollowUps: unanswered,
  };
}

// ---------- known vs unknown ----------

export const UNKNOWN_TOPICS: { label: string; re: RegExp }[] = [
  { label: "delivery time", re: /deliver|dispatch|ship(?:ping|ped|ment)?\b|lead time/i },
  { label: "discount", re: /discount|best price|final price|reduc|chhoot|chhut|offer|kam\s+kar/i },
  { label: "warranty", re: /warrant|guarantee|\bamc\b/i },
  { label: "installation", re: /install|commission|set-?up|training/i },
  { label: "stock", re: /\bstock\b|availab/i },
  { label: "payment terms", re: /advance|payment|\bgst\b|credit|\bemi\b|bank|proforma|cheque|\bupi\b|\d\s*%/i },
  { label: "specs", re: /\bspecs?\b|specification|capacity|pouch\/min|per hour|\bhp\b|\bkw\b|voltage|speed|\bmm\b|\bhead/i },
];

export interface KnownUnknown {
  known: string[]; // human-readable lines
  unknown: string[]; // topic labels the chat never mentions
}

export function knownAndUnknown(facts: FactSheet, messages: Msg[]): KnownUnknown {
  const all = messages.map((m) => m.text).join("\n");
  const known: string[] = [];
  if (facts.prices.length) known.push(`prices ${facts.prices.map((p) => p.text).join(", ")}`);
  if (facts.quantities.length) known.push(`quantities ${facts.quantities.map((q) => q.text).join(", ")}`);
  if (facts.productsMentioned.length) known.push(`products ${facts.productsMentioned.join(", ")}`);
  if (facts.datesMentioned.length) known.push(`dates ${facts.datesMentioned.map((d) => d.text).join(", ")}`);
  if (facts.promisesByRep.length) known.push(`${facts.promisesByRep.length} promise(s) already made by the rep`);
  return { known, unknown: UNKNOWN_TOPICS.filter((t) => !t.re.test(all)).map((t) => t.label) };
}
