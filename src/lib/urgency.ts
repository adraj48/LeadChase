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
    // Earlier followUpDate first: most overdue first, upcoming ascending, today ties.
    if (a.followUpDate !== b.followUpDate) return a.followUpDate < b.followUpDate ? -1 : 1;
    return TAG_RANK[a.tag] - TAG_RANK[b.tag];
  });
}
