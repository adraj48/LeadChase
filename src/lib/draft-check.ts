import type { Lead, Message } from "@/lib/types";
import { diffDays, istDateOf } from "@/lib/dates";
import { extractNumberTokens } from "@/lib/number-tokens";
import { extractFacts, languageOfText } from "@/lib/draft-facts";
import { FORBIDDEN_PHRASES, OFFER_WORDS } from "@/lib/draft-voice";

// Second anti-hallucination layer (the first is the prompt and its fact sheet): a pure,
// deterministic check of a finished draft against what the model was allowed to know.
// It never blocks anything; the UI shows the problems as a "check before sending" notice
// and, for grounding and language problems, asks for one automatic rewrite.

export interface DraftCheckContext {
  lead: Pick<Lead, "name" | "company" | "source" | "reason" | "lastContactDate" | "followUpDate">;
  messages: Pick<Message, "from" | "text" | "at">[];
  todayIST: string; // YYYY-MM-DD
}

/** grounding = something not in the chat; language = wrong language or script; style = tone or length. */
export interface DraftProblem {
  kind: "grounding" | "language" | "style";
  text: string;
}

export const DRAFT_CHECK_MAX_CHARS = 700;
export const DRAFT_MAX_WORDS = 60;
/** A reply to a very short buyer message ("Ok, will check") should be short too. */
export const SHORT_BUYER_WORDS = 12;
export const SHORT_REPLY_MAX_WORDS = 35;

interface Grounding {
  values: Set<number>;
  percents: Set<number>; // a percentage is only grounded by a percentage
  dates: Set<string>;
}

function groundingOf(ctx: DraftCheckContext): Grounding {
  const values = new Set<number>();
  const percents = new Set<number>();
  const dates = new Set<string>();
  const addText = (s: string) => {
    for (const t of extractNumberTokens(s)) {
      if (t.kind === "date") {
        dates.add(t.dateKey!);
        values.add(t.day!); // "after 15th" grounds the day number
      } else if (t.kind === "percent") percents.add(t.value!);
      else values.add(t.value!);
    }
  };
  const addDate = (iso: string) => {
    for (const t of extractNumberTokens(iso)) if (t.kind === "date") dates.add(t.dateKey!);
  };
  const { lead } = ctx;
  for (const s of [lead.name, lead.company, lead.source, lead.reason]) addText(s ?? "");
  for (const m of ctx.messages) {
    addText(m.text);
    addDate(istDateOf(m.at));
  }
  for (const d of [ctx.todayIST, lead.lastContactDate, lead.followUpDate]) addDate(d);
  // "Last contact: N days ago" is part of the prompt, so N is a given fact.
  const ago = diffDays(ctx.todayIST, lead.lastContactDate);
  if (Number.isFinite(ago)) values.add(Math.abs(ago));
  return { values, percents, dates };
}

const COMMIT_RE =
  /\b(?:definitely|certainly|sure|happy to|glad to|we can|i can|we will|i will|we'll|i'll)\b[^.!?]{0,40}\b(?:arrange|organi[sz]e|provide|offer|give|set up|schedule|send|do)\b/i;
const DONE_RE =
  /\b(?:i|we)(?:'ve|\s+have)?\s+(?:already\s+)?(?:sent|shared|emailed|mailed)\b|\b(?:bhej|send|share|mail)\s+(?:diya|kar diya|kar di|di hai)\b/i;
const SENT_IN_CHAT_RE = /\b(?:send|sent|shar|bhej|mail|email)/i;
const GENDERED_RE = /\b\w+(?:ta|ti)\s+(?:hoon|hun|hu)\b|\b\w+(?:unga|ungi)\b|\b(?:bhej|bata|de|le|kar|dekh|bol|aa|ja)(?:ta|ti)\s+raha?\s+(?:hoon|hun)\b/i;
const ATTACH_RE = /\b(?:ye|yeh)\s+rah[ie]\b|\bhere (?:is|are) (?:the|our|my)\b|\battached\b|\battach\s+(?:kar|kiya)|\bplease find\b/i;
const PLACEHOLDER_RE = /\[[^\]\n]*\]|\{[^}\n]*\}/;
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

/**
 * Problems in `draft`, as {kind, text}. Empty when nothing looks wrong. Numbers are
 * compared by value after normalising commas, spaces, Rs/Rs./INR/the rupee sign and
 * lakh/lac/L/k, so "Rs 64,500" matches "64500".
 */
export function findUngroundedFacts(draft: string, ctx: DraftCheckContext): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.trim()) return problems;
  const g = groundingOf(ctx);
  const chat = ctx.messages.map((m) => m.text).join("\n");

  // --- grounding ---
  const seen = new Set<string>();
  for (const t of extractNumberTokens(draft)) {
    const ok =
      t.kind === "date"
        ? g.dates.has(t.dateKey!) || g.values.has(t.day!)
        : t.kind === "percent"
          ? g.percents.has(t.value!)
          : g.values.has(t.value!);
    if (ok || seen.has(t.raw.toLowerCase())) continue;
    seen.add(t.raw.toLowerCase());
    problems.push({ kind: "grounding", text: `Mentions ${t.raw}, which isn't in this chat` });
  }
  for (const o of OFFER_WORDS) {
    const hit = draft.match(o.re);
    if (hit && !o.inChat.test(chat)) {
      problems.push({ kind: "grounding", text: `Offers or mentions "${hit[0].trim()}", which isn't in this chat` });
    }
  }
  // The buyer asking for a demo is not the rep offering one: agreeing needs a "will check" first.
  const repChat = ctx.messages.filter((m) => m.from === "rep").map((m) => m.text).join("\n");
  for (const sentence of draft.split(/(?<=[.!?])\s+/)) {
    if (!COMMIT_RE.test(sentence)) continue;
    for (const o of OFFER_WORDS) {
      if (o.label !== "email" && o.re.test(sentence) && o.inChat.test(chat) && !o.inChat.test(repChat)) {
        problems.push({ kind: "grounding", text: `Promises a ${o.label} that nobody on the rep's side has offered in this chat` });
      }
    }
  }
  // Claiming something was already sent when the chat never shows it (a leftover from an old draft).
  if (DONE_RE.test(draft) && !SENT_IN_CHAT_RE.test(repChat)) {
    problems.push({ kind: "grounding", text: "Says something was already sent or shared, but the chat doesn't show that" });
  }
  // Pretending to paste or attach something the agent does not have (bank details, a quote file).
  if (ATTACH_RE.test(draft)) {
    problems.push({ kind: "grounding", text: "Says something is attached or pasted below, but nothing is; say you will send it instead" });
  }
  const ph = draft.match(PLACEHOLDER_RE);
  if (ph) problems.push({ kind: "grounding", text: `Contains a placeholder (${ph[0]}) to fill in` });

  // --- language ---
  const facts = extractFacts(ctx.lead, ctx.messages, ctx.todayIST);
  const want = facts.language;
  const got = languageOfText(draft);
  if (want !== "unknown") {
    const devanagari = /[ऀ-ॿ]/.test(draft);
    if (devanagari && want !== "hindi-devanagari") {
      problems.push({ kind: "language", text: "Uses Devanagari script, but the buyer wrote in Roman script" });
    } else if (!devanagari && want === "hindi-devanagari") {
      problems.push({ kind: "language", text: "Is written in Roman script, but the buyer wrote in Devanagari" });
    } else if (want === "english" && got === "hinglish") {
      problems.push({ kind: "language", text: "Is written in Hinglish, but the buyer wrote in English" });
    } else if (want === "hinglish" && got === "english" && wordCount(draft) >= 6) {
      problems.push({ kind: "language", text: "Is written in English, but the buyer wrote in Hinglish" });
    }
  } else if (/[ऀ-ॿ]/.test(draft) && !/[ऀ-ॿ]/.test(chat)) {
    problems.push({ kind: "language", text: "Uses Devanagari script, but nobody in this chat did" });
  }

  // A form of address or regional greeting the rep has not used with this buyer.
  const ADDRESS = draft.match(/\b(sir|madam|ma'am|bhai|didi|vanakkam|namaskar|sat sri akal)\b/i);
  if (ADDRESS && !new RegExp(`\\b${ADDRESS[1].replace("'", "'?")}\\b`, "i").test(chat)) {
    problems.push({ kind: "language", text: `Uses "${ADDRESS[1]}", which nobody in this chat has used` });
  }

  // Gendered first-person verbs (the rep's gender is not known).
  const gendered = draft.match(GENDERED_RE);
  if (gendered) {
    problems.push({ kind: "language", text: `Uses a gendered verb ("${gendered[0]}"); use a neutral form such as "bhej dete hain"` });
  }

  // --- style ---
  for (const f of FORBIDDEN_PHRASES) {
    if (f.re.test(draft)) problems.push({ kind: "style", text: `Uses a stock phrase (${f.label})` });
  }
  const words = wordCount(draft);
  if (draft.length > DRAFT_CHECK_MAX_CHARS) {
    problems.push({ kind: "style", text: `Is ${draft.length} characters long, which is too long for WhatsApp` });
  } else if (words > DRAFT_MAX_WORDS) {
    problems.push({ kind: "style", text: `Is ${words} words long, over the ${DRAFT_MAX_WORDS}-word limit` });
  } else if (facts.buyerLastMessage) {
    const bw = wordCount(facts.buyerLastMessage);
    if (bw < SHORT_BUYER_WORDS && words > SHORT_REPLY_MAX_WORDS) {
      problems.push({ kind: "style", text: `Is ${words} words long for a ${bw}-word buyer message` });
    }
  }
  return problems;
}

/** The problems that justify an automatic rewrite. */
export function needsRepair(problems: DraftProblem[]): boolean {
  return problems.some((p) => p.kind === "grounding" || p.kind === "language");
}
