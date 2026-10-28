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
export function istDateOf(iso: string): string {
  return todayIST(new Date(iso));
}
