import type { Lead, Message, Rep, Tag } from "@/lib/types";
import type { AgentResult } from "@/lib/agent";

export interface RepRow {
  id: string;
  name: string;
}

export interface LeadRow {
  id: string;
  rep_id: string;
  name: string;
  company: string;
  phone: string;
  source: string;
  last_contact_date: string;
  tag: string;
  reason: string;
  follow_up_date: string;
  draft: string;
  analysis_source: string;
  analysis_status?: string;
  analysis_started_at?: string | null;
  // PostgREST embeds a to-one relation as an object; tolerate an array too.
  reps?: { name: string } | { name: string }[] | null;
}

// GET lead reads the lead and its chat in one request (PostgREST embed).
export interface LeadWithMessagesRow extends LeadRow {
  messages?: MessageRow[] | null;
}

export interface MessageRow {
  id: string;
  lead_id: string;
  sender: string;
  body: string;
  sent_at: string;
}

export function mapRep(r: RepRow): Rep {
  return { id: r.id, name: r.name };
}

export function mapLead(r: LeadRow): Lead {
  const joined = Array.isArray(r.reps) ? r.reps[0] : r.reps;
  const lead: Lead = {
    id: r.id,
    repId: r.rep_id,
    repName: joined?.name ?? "",
    name: r.name,
    company: r.company,
    phone: r.phone,
    source: r.source,
    lastContactDate: r.last_contact_date,
    tag: r.tag as Tag,
    reason: r.reason,
    followUpDate: r.follow_up_date,
    draft: r.draft,
    analysisSource: r.analysis_source as Lead["analysisSource"],
  };
  // Only when the columns exist (database migrated); otherwise the lead is simply ready.
  if (r.analysis_status !== undefined) {
    lead.analysisStatus = r.analysis_status === "pending" ? "pending" : "ready";
    lead.analysisStartedAt = r.analysis_started_at ?? null;
  }
  return lead;
}

export function mapMessage(r: MessageRow): Message {
  return {
    id: r.id,
    leadId: r.lead_id,
    from: r.sender as Message["from"],
    text: r.body,
    at: r.sent_at,
  };
}

/** Analysis fields -> snake_case columns (shared by insert and update). */
export function leadToRow(a: AgentResult) {
  return {
    tag: a.tag,
    reason: a.reason,
    follow_up_date: a.followUpDate,
    draft: a.draft,
    analysis_source: a.analysisSource,
  };
}
