import { daysOverdue } from "./dates";
import type { Bucket, Lead, Tag } from "./types";

const TAG_RANK: Record<Tag, number> = { Hot: 0, Warm: 1, Cold: 2 };
const BUCKET_RANK: Record<Bucket, number> = { overdue: 0, today: 1, upcoming: 2 };

export function bucketOf(lead: Pick<Lead, "followUpDate">, today: string): Bucket {
  const d = daysOverdue(lead.followUpDate, today);
  if (d > 0) return "overdue";
  if (d === 0) return "today";
  return "upcoming";
}

export function sortByUrgency<T extends Pick<Lead, "followUpDate" | "tag">>(
  leads: T[],
  today: string,
): T[] {
  return [...leads].sort((a, b) => {
    const bucketDiff = BUCKET_RANK[bucketOf(a, today)] - BUCKET_RANK[bucketOf(b, today)];
    if (bucketDiff !== 0) return bucketDiff;
    const bucket = bucketOf(a, today);
    const byDate = a.followUpDate === b.followUpDate ? 0 : a.followUpDate < b.followUpDate ? -1 : 1;
    const byTag = TAG_RANK[a.tag] - TAG_RANK[b.tag];
    // Overdue and today: Hot > Warm > Cold, then most overdue first.
    // Upcoming: earliest date first, then tag.
    if (bucket === "upcoming") return byDate || byTag;
    return byTag || byDate;
  });
}
