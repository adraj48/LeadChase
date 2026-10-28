const MS_PER_DAY = 86_400_000;

function toUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function addDays(iso: string, n: number): string {
  return new Date(toUtcMs(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function diffDays(later: string, earlier: string): number {
  return Math.round((toUtcMs(later) - toUtcMs(earlier)) / MS_PER_DAY);
}

export function daysOverdue(followUpDate: string, today: string): number {
  return diffDays(today, followUpDate);
}

// Asia/Kolkata calendar date (YYYY-MM-DD) of an ISO instant.
// An unparseable timestamp falls back to the first 10 characters (or empty string), never throws.
export function istDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return typeof iso === "string" ? iso.slice(0, 10) : "";
  return todayIST(d);
}
