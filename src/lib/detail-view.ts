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

export function sentToast(followUpDate: string, today: string): string {
  const ahead = diffDays(followUpDate, today);
  const when = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : formatDateLabel(followUpDate);
  return `Sent. Next follow-up: ${when}`;
}

export function analysisNote(source: Lead["analysisSource"]): string | null {
  return source === "fallback" ? "AI unavailable — rule-based suggestion" : null;
}

export function telHref(phone: string): string {
  const p = phone.replace(/\s+/g, "");
  return `tel:${p.startsWith("+") ? p : `+91${p}`}`;
}
