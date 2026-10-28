// Browser-side loader for GET /api/leads/[id], used through the LeadCache.
import type { Lead, Message } from "./types";
import { LeadCache } from "./lead-cache";

export interface LeadDetailData {
  lead: Lead;
  messages: Message[];
}

export class LeadFetchError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "LeadFetchError";
  }
}

/** Validate a detail response body; throws LeadFetchError on a malformed one. */
export function parseDetailBody(body: unknown): LeadDetailData {
  const b = body as { lead?: unknown; messages?: unknown } | null;
  if (!b || !b.lead || typeof b.lead !== "object" || !Array.isArray(b.messages)) {
    throw new LeadFetchError(0, "Unexpected response from server");
  }
  return { lead: b.lead as Lead, messages: b.messages as Message[] };
}

export async function fetchLeadDetail(id: string, signal: AbortSignal): Promise<LeadDetailData> {
  const res = await fetch(`/api/leads/${encodeURIComponent(id)}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof body?.error === "string" ? body.error : "Something went wrong";
    throw new LeadFetchError(res.status, res.status === 404 ? "Lead not found" : msg);
  }
  return parseDetailBody(body);
}

export function createLeadDetailCache(): LeadCache<LeadDetailData> {
  return new LeadCache<LeadDetailData>({ fetcher: fetchLeadDetail });
}

/**
 * Leads worth warming first once the list is shown: overdue, then Hot, in list order
 * (the list is already sorted by urgency), capped at `max`.
 */
export function warmupIds(leads: Pick<Lead, "id" | "tag" | "followUpDate">[], today: string, max = 3): string[] {
  const overdue = leads.filter((l) => l.followUpDate < today);
  const hot = leads.filter((l) => l.followUpDate >= today && l.tag === "Hot");
  return [...overdue, ...hot].slice(0, max).map((l) => l.id);
}
