import type { Message, Tag } from "@/lib/types";
import { diffDays, istDateOf } from "@/lib/dates";
import { formatDateLabel } from "@/lib/detail-view";
import {
  buildTimeline,
  extractFacts,
  knownAndUnknown,
  type FactSheet,
  type Timeline,
} from "@/lib/draft-facts";
import { deriveNextAction, renderNextAction } from "@/lib/next-action";

// Builds the context both prompts send to the model: LEAD, PREVIOUS DRAFT, TIMELINE,
// FACT SHEET, CHAT, KNOWN vs UNKNOWN and NEXT BEST ACTION. Everything is computed here
// in-process; nothing extra is fetched. The phone number is never included.

export const MAX_CHAT_MESSAGES = 80;
export const KEEP_FIRST = 3;
export const KEEP_LAST = 60;
export const MAX_MESSAGE_CHARS = 1500;
const MAX_FIELD_CHARS = 200;
const MAX_REASON_CHARS = 300;
const MAX_FACT_QUOTE = 500;

export interface ContextLead {
  name: string;
  company: string;
  source: string;
  lastContactDate: string;
  tag?: Tag;
  reason?: string;
  followUpDate?: string;
  draft?: string;
}

export type ContextMessage = Pick<Message, "from" | "text" | "at">;

export interface ContextInput {
  repFirstName: string;
  lead: ContextLead;
  messages: ContextMessage[];
  todayIST: string; // YYYY-MM-DD
}

const TAGS = /<\s*\/?\s*(?:chat|lead|timeline|fact_sheet|previous_draft|next_action|known_unknown|repair)\s*>/gi;

/** Collapse whitespace, drop control/zero-width characters and any block tag (tag injection). */
export function cleanPromptText(raw: string, max: number): string {
  let s = String(raw ?? "")
    .replace(/[\u2028\u2029\s]+/g, " ")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  // Repeat until stable so a split tag such as "<ch<chat>at>" cannot reassemble.
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(TAGS, "");
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s;
}

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "16 Oct 2026, 10:40 IST". Built from parts so ICU separators do not matter. */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const p: Record<string, string> = {};
  for (const part of TIME_FMT.formatToParts(d)) p[part.type] = part.value;
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} IST`;
}

export function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

function daysAgo(today: string, date: string): string {
  const n = diffDays(today, date);
  if (!Number.isFinite(n) || n <= 0) return "today";
  return n === 1 ? "1 day ago" : `${n} days ago`;
}

/**
 * Whole chat up to MAX_CHAT_MESSAGES. Longer chats keep the first KEEP_FIRST and the
 * last KEEP_LAST messages. `index` is the 1-based position in the full chat.
 */
export function selectChat<T>(messages: T[]): { index: number; message: T | null }[] {
  const all: { index: number; message: T | null }[] = messages.map((message, i) => ({ index: i + 1, message }));
  if (all.length <= MAX_CHAT_MESSAGES) return all;
  return [...all.slice(0, KEEP_FIRST), { index: -1, message: null }, ...all.slice(-KEEP_LAST)];
}

function renderChat(messages: ContextMessage[], today: string): string {
  if (messages.length === 0) return "(no messages yet)";
  const lines: string[] = [];
  for (const { index, message } of selectChat(messages)) {
    if (!message) {
      lines.push("[earlier messages omitted]");
      continue;
    }
    const day = formatMessageTime(message.at);
    const when = Number.isNaN(new Date(message.at).getTime())
      ? ""
      : `, ${daysAgo(today, istDateOf(message.at))}`;
    lines.push(
      `${index}. ${message.from === "rep" ? "Rep" : "Buyer"} (${day}${when}): ${cleanPromptText(message.text, MAX_MESSAGE_CHARS)}`,
    );
  }
  return lines.join("\n");
}

function list<T>(items: T[], f: (t: T) => string): string {
  return items.length ? items.map(f).join("; ") : "none";
}

export function renderFactSheet(f: FactSheet, today: string): string {
  const q = (s: string) => `"${cleanPromptText(s, MAX_FACT_QUOTE)}"`;
  return [
    "FACT SHEET (the only facts you may use)",
    `- Last message in the chat: from ${f.whoSpokeLast === "buyer" ? "the buyer" : f.whoSpokeLast === "rep" ? "the rep" : "nobody"}${f.daysSinceLastMessage === null ? "" : `, ${f.daysSinceLastMessage === 0 ? "today" : `${f.daysSinceLastMessage} day(s) ago`}`}`,
    `- Buyer's last message, verbatim: ${f.buyerLastMessage ? q(f.buyerLastMessage) : "none yet"}`,
    `- Language to reply in: ${f.language === "hinglish" ? "Hinglish (Roman script)" : f.language === "hindi-devanagari" ? "Hindi in Devanagari" : f.language === "english" ? "English" : "English (no buyer message yet)"}`,
    `- Where the buyer stands: ${f.buyerDecision}`,
    `- Prices in the chat: ${list(f.prices, (p) => `${p.text} (${p.from === "rep" ? "Rep" : "Buyer"}, message ${p.messageIndex})`)}`,
    `- Quantities: ${list(f.quantities, (x) => `${x.text} (message ${x.messageIndex})`)}`,
    `- Products mentioned: ${f.productsMentioned.length ? f.productsMentioned.join(", ") : "none"}`,
    `- Dates and timeframes mentioned: ${list(f.datesMentioned, (x) => `${x.text} (message ${x.messageIndex}${x.resolved ? `, that is ${formatDateLabel(x.resolved)}${x.resolved === today ? ", today" : x.resolved < today ? ", already past" : ""}` : ""})`)}`,
    `- Promises the rep already made: ${list(f.promisesByRep, (x) => `message ${x.messageIndex} ${q(x.text)}`)}`,
    `- Open buyer questions, not yet answered: ${list(f.openBuyerQuestions, (x) => `message ${x.messageIndex} ${q(x.text)}`)}`,
  ].join("\n");
}

export function renderTimeline(t: Timeline, today: string): string {
  const d = (iso: string | null) => (iso ? `${formatDateLabel(iso)} (${daysAgo(today, iso)})` : "never");
  return [
    "TIMELINE",
    `- First contact: ${formatDateLabel(t.firstContact)}`,
    `- Quote or price moments: ${list(t.quoteMoments, (m) => `message ${m.messageIndex} (${formatDateLabel(m.date)}, ${m.from === "rep" ? "Rep" : "Buyer"})`)}`,
    `- Last buyer message: ${d(t.lastBuyerDate)}`,
    `- Last rep message: ${d(t.lastRepDate)}`,
    `- Days since the buyer last replied: ${t.daysSinceBuyerReplied ?? "the buyer has never replied"}`,
    `- Days since the rep last wrote: ${t.daysSinceRepWrote ?? "the rep has not written yet"}`,
    `- Rep messages sent since the buyer last replied: ${t.unansweredFollowUps}`,
  ].join("\n");
}

export interface BuiltContext {
  text: string;
  facts: FactSheet;
  timeline: Timeline;
}

export function buildContext(input: ContextInput): BuiltContext {
  const { lead, messages, todayIST } = input;
  const facts = extractFacts(lead, messages, todayIST);
  const timeline = buildTimeline(lead, messages, todayIST, facts);
  const next = deriveNextAction(facts, timeline, cleanPromptText(lead.source, MAX_FIELD_CHARS));
  const ku = knownAndUnknown(facts, messages);

  const leadLines = [
    `Name: ${cleanPromptText(lead.name, MAX_FIELD_CHARS)}`,
    `Company: ${cleanPromptText(lead.company, MAX_FIELD_CHARS)}`,
    `Source: ${cleanPromptText(lead.source, MAX_FIELD_CHARS)}`,
    ...(lead.tag ? [`Current tag: ${lead.tag}`] : []),
    ...(lead.reason ? [`Tag reason: ${cleanPromptText(lead.reason, MAX_REASON_CHARS)}`] : []),
    `Last contact: ${formatDateLabel(lead.lastContactDate)} (${daysAgo(todayIST, lead.lastContactDate)})`,
    ...(lead.followUpDate ? [`Follow-up date: ${formatDateLabel(lead.followUpDate)}`] : []),
    `Rep: ${cleanPromptText(input.repFirstName, 40) || "the rep"}`,
  ];

  const parts = [
    `Today (IST): ${weekdayOf(todayIST)}, ${formatDateLabel(todayIST)}`,
    `<lead>\n${leadLines.join("\n")}\n</lead>`,
    ...(lead.draft?.trim()
      ? [
          `<previous_draft>\nPREVIOUS DRAFT (not sent yet; do not repeat it word for word; improve on it using the chat)\n${cleanPromptText(lead.draft, 1000)}\n</previous_draft>`,
        ]
      : []),
    `<timeline>\n${renderTimeline(timeline, todayIST)}\n</timeline>`,
    `<fact_sheet>\n${renderFactSheet(facts, todayIST)}\n</fact_sheet>`,
    `<chat>\n${renderChat(messages, todayIST)}\n</chat>`,
    `<known_unknown>\nKNOWN vs UNKNOWN\nKNOWN: ${ku.known.length ? ku.known.join("; ") : "nothing beyond the chat itself"}.\nUNKNOWN (not in this chat): ${ku.unknown.length ? ku.unknown.join(", ") : "none of the usual topics"}. If the buyer asks about an UNKNOWN item, say you will confirm and revert; never guess.\n</known_unknown>`,
    `<next_action>\n${renderNextAction(next)}\n</next_action>`,
  ];
  return { text: parts.join("\n\n"), facts, timeline };
}
