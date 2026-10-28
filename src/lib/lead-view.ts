import { daysOverdue, diffDays } from "./dates";
import { bucketOf } from "./urgency";
import type { Bucket, Lead, Tag } from "./types";

export interface LeadGroups {
  overdue: Lead[];
  today: Lead[];
  upcoming: Lead[];
}

export function groupLeads(leads: Lead[], today: string): LeadGroups {
  const groups: LeadGroups = { overdue: [], today: [], upcoming: [] };
  for (const lead of leads) groups[bucketOf(lead, today)].push(lead);
  return groups;
}

export function followUpLabel(
  followUpDate: string,
  today: string,
): { text: string; tone: Bucket } {
  const late = daysOverdue(followUpDate, today);
  if (late > 0) return { text: `Overdue ${late}d`, tone: "overdue" };
  if (late === 0) return { text: "Today", tone: "today" };
  const ahead = diffDays(followUpDate, today);
  return { text: ahead === 1 ? "Tomorrow" : `in ${ahead}d`, tone: "upcoming" };
}

export function tagCounts(leads: Lead[]): Record<Tag, number> {
  const counts: Record<Tag, number> = { Hot: 0, Warm: 0, Cold: 0 };
  for (const l of leads) counts[l.tag] += 1;
  return counts;
}

export function summaryLine(groups: LeadGroups): string {
  const parts: string[] = [];
  if (groups.overdue.length) parts.push(`${groups.overdue.length} overdue`);
  if (groups.today.length) parts.push(`${groups.today.length} due today`);
  return parts.length ? parts.join(" · ") : "Nothing due today";
}
