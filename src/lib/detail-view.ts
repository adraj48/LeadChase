import { diffDays } from "./dates";
import type { Lead } from "./types";

export const MAX_DRAFT = 1000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHAT_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Built from parts so the output does not depend on the ICU version's separators.
export function formatChatTime(iso: string): string {
  const p: Record<string, string> = {};
  for (const part of CHAT_FMT.formatToParts(new Date(iso))) p[part.type] = part.value;
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}`;
}

export function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function canSend(draft: string, busy: boolean): boolean {
  return !busy && draft.trim().length > 0 && draft.length <= MAX_DRAFT;
}

export function canSave(draft: string, saved: string, busy: boolean): boolean {
  return canSend(draft, busy) && draft !== saved;
}

function whenWord(followUpDate: string, today: string): string {
  const ahead = diffDays(followUpDate, today);
  return ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : formatDateLabel(followUpDate);
}

export function sentToast(followUpDate: string, today: string): string {
  return `Sent. Next follow-up: ${whenWord(followUpDate, today)}`;
}

export function canAddMessage(text: string, busy: boolean): boolean {
  return !busy && text.trim().length > 0 && text.length <= MAX_DRAFT;
}

export function updatedNote(lead: Pick<Lead, "tag" | "followUpDate">, today: string): string {
  return `Updated: ${lead.tag} · follow-up ${whenWord(lead.followUpDate, today)}`;
}

export function analysisNote(source: Lead["analysisSource"]): string | null {
  return source === "fallback" ? "AI unavailable — rule-based suggestion" : null;
}

export function telHref(phone: string): string {
  const p = phone.replace(/\s+/g, "");
  return `tel:${p.startsWith("+") ? p : `+91${p}`}`;
}

export function headingText(state: "loading" | "error" | "loaded", name: string): string {
  if (state === "loading") return "Loading lead…";
  if (state === "error") return "Couldn't load this lead";
  return name;
}

/**
 * A background revalidation (or the first full load) brought a draft. Replace the
 * box only when it is clean and the agent is not writing into it; otherwise keep the
 * rep's text untouched (null = keep).
 */
export function revalidatedDraft(
  box: { text: string; saved: string; agentBusy: boolean },
  incoming: string,
): { text: string; saved: string } | null {
  if (box.agentBusy || box.text !== box.saved) return null;
  if (box.text === incoming) return null;
  return { text: incoming, saved: incoming };
}

/** Fields that make a list row look different; used to skip no-op list updates. */
export function sameRow(
  a: Pick<Lead, "tag" | "reason" | "followUpDate" | "draft" | "analysisStatus" | "analysisStartedAt" | "lastContactDate" | "name" | "company" | "phone">,
  b: typeof a,
): boolean {
  return (
    a.tag === b.tag &&
    a.reason === b.reason &&
    a.followUpDate === b.followUpDate &&
    a.draft === b.draft &&
    a.analysisStatus === b.analysisStatus &&
    (a.analysisStartedAt ?? null) === (b.analysisStartedAt ?? null) &&
    a.lastContactDate === b.lastContactDate &&
    a.name === b.name &&
    a.company === b.company &&
    a.phone === b.phone
  );
}
