import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Message, Rep } from "@/lib/types";
import type { AgentResult } from "@/lib/agent";
import { leadToRow, mapLead, mapMessage, mapRep, type LeadWithMessagesRow, type LeadRow } from "@/lib/mappers";

// Data access for the API routes. Every function takes the server Supabase client
// (service role, demo mode: see src/lib/supabase/server.ts), so callers must validate
// input before writing.
//
// Supabase HTTP requests per route (each one is a network round trip; "||" = sent in
// parallel, so it costs one round trip of wall-clock time). Steady state, i.e. the
// analysis columns exist:
//   GET  /api/reps                      1  listReps
//   GET  /api/leads[?rep=all]           1  listLeads
//   GET  /api/leads?rep=<uuid>          1  listLeads (+1 getRep only when the list is
//                                          empty, to tell "no leads" from "unknown rep")
//   GET  /api/leads/[id]                1  getLead (lead + rep name + chat, one embed)
//   POST /api/leads                     2  getRep, then createLead (model call between)
//   PUT  /api/leads/[id]/draft          1  saveDraft
//   POST /api/leads/[id]/messages|sent  2 round trips / 3 requests before the response:
//                                          getLead, then addMessage || beginAnalysis
//                                          (2 requests for a retried duplicate: no insert);
//                                          after the response: finishAnalysis (1)
//   POST /api/leads/[id]/draft-suggestion  1  getLead (then the model stream)
// Before this change the auth check alone cost every route one extra reps lookup (plus
// a middleware JWT check), GET lead used 2 parallel requests and POST /messages 3
// sequential ones.

export interface NewLeadInput {
  name: string;
  company: string;
  phone: string;
  source: string;
  lastContactDate: string;
  repId: string; // required: validated as a uuid, then checked against the reps table
}

const LEAD_COLS =
  "id, rep_id, name, company, phone, source, last_contact_date, tag, reason, follow_up_date, draft, analysis_source, reps(name)";
// Same plus the realtime_analysis migration columns.
const LEAD_COLS_V2 = LEAD_COLS.replace("analysis_source,", "analysis_source, analysis_status, analysis_started_at,");
const MESSAGE_COLS = "id, lead_id, sender, body, sent_at";
const REP_COLS = "id, name";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(`Supabase error: ${error.message}`);
}

// Compatibility with a database that has not had the realtime_analysis migration
// applied yet: the first query that names analysis_status / analysis_started_at
// fails with "column does not exist" (Postgres 42703, or PostgREST PGRST204 for a
// write payload). We then retry once without those columns, remember that for a
// minute, and the routes fall back to the synchronous analysis path. Once the
// migration is applied the next probe succeeds and the fast path switches on.
const RECHECK_MS = 60_000;
let columnsMissingUntil = 0;
let warned = false;

type Res = { error: { code?: string; message: string } | null };

function isMissingColumn(error: Res["error"]): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /analysis_(status|started_at)/.test(error.message) && /column|schema cache/i.test(error.message);
}

/** True while the database is known to lack the new columns (compatibility mode). */
export function analysisColumnsMissing(): boolean {
  return Date.now() < columnsMissingUntil;
}

function markColumnsMissing(): void {
  columnsMissingUntil = Date.now() + RECHECK_MS;
  if (!warned) {
    warned = true;
    console.warn("analysis_status columns not found: running without them. Apply the realtime_analysis migration.");
  }
}

async function withAnalysisCols<T extends Res>(run: (v2: boolean) => PromiseLike<T>): Promise<T> {
  if (!analysisColumnsMissing()) {
    const res = await run(true);
    if (!isMissingColumn(res.error)) return res;
    markColumnsMissing();
  }
  return run(false);
}

// The reps table may still hold the retired owner row until the demo is re-seeded;
// only role = 'rep' rows are reps.
export async function listReps(sb: SupabaseClient): Promise<Rep[]> {
  const { data, error } = await sb.from("reps").select(REP_COLS).eq("role", "rep").order("name");
  fail(error);
  return (data ?? []).map(mapRep);
}

/** One rep by id, or null when no such rep exists. */
export async function getRep(sb: SupabaseClient, id: string): Promise<Rep | null> {
  const { data, error } = await sb.from("reps").select(REP_COLS).eq("id", id).eq("role", "rep").maybeSingle();
  fail(error);
  return data ? mapRep(data) : null;
}

export async function listLeads(sb: SupabaseClient, filterRepId?: string): Promise<Lead[]> {
  const { data, error } = await withAnalysisCols((v2) => {
    let q = sb.from("leads").select(v2 ? LEAD_COLS_V2 : LEAD_COLS);
    if (filterRepId) q = q.eq("rep_id", filterRepId);
    return q.order("follow_up_date", { ascending: true });
  });
  fail(error);
  return ((data ?? []) as unknown as LeadRow[]).map(mapLead);
}

/**
 * The lead, its rep's name and its whole chat in ONE request: PostgREST embeds the
 * messages (foreign key messages.lead_id) and orders them oldest first.
 */
export async function getLead(
  sb: SupabaseClient,
  id: string,
): Promise<{ lead: Lead; messages: Message[] } | null> {
  const { data, error } = await withAnalysisCols((v2) =>
    sb
      .from("leads")
      .select(`${v2 ? LEAD_COLS_V2 : LEAD_COLS}, messages(${MESSAGE_COLS})`)
      .eq("id", id)
      .order("sent_at", { referencedTable: "messages", ascending: true })
      .order("id", { referencedTable: "messages", ascending: true })
      .maybeSingle(),
  );
  fail(error);
  if (!data) return null;
  const { messages, ...row } = data as unknown as LeadWithMessagesRow;
  return { lead: mapLead(row), messages: (messages ?? []).map(mapMessage) };
}

export async function createLead(
  sb: SupabaseClient,
  input: NewLeadInput,
  a: AgentResult,
): Promise<Lead> {
  const { data, error } = await withAnalysisCols((v2) =>
    sb
      .from("leads")
      .insert({
        rep_id: input.repId,
        name: input.name,
        company: input.company,
        phone: input.phone,
        source: input.source,
        last_contact_date: input.lastContactDate,
        ...leadToRow(a),
      })
      .select(v2 ? LEAD_COLS_V2 : LEAD_COLS)
      .single(),
  );
  fail(error);
  return mapLead(data as unknown as LeadRow);
}

export async function addMessage(
  sb: SupabaseClient,
  leadId: string,
  from: "rep" | "buyer",
  text: string,
): Promise<Message | null> {
  const { data, error } = await sb
    .from("messages")
    .insert({ lead_id: leadId, sender: from, body: text })
    .select(MESSAGE_COLS)
    .single();
  // 23503 = foreign key violation: the parent lead no longer exists.
  if (error && error.code === "23503") return null;
  fail(error);
  return data ? mapMessage(data) : null;
}

export async function saveAnalysis(
  sb: SupabaseClient,
  leadId: string,
  a: AgentResult,
  lastContactDate?: string,
): Promise<boolean> {
  const patch: Record<string, string> = leadToRow(a);
  if (lastContactDate) patch.last_contact_date = lastContactDate;
  const { data, error } = await sb.from("leads").update(patch).eq("id", leadId).select("id");
  fail(error);
  return (data?.length ?? 0) > 0;
}

export async function saveDraft(sb: SupabaseClient, leadId: string, draft: string): Promise<boolean> {
  const { data, error } = await sb.from("leads").update({ draft }).eq("id", leadId).select("id");
  fail(error);
  return (data?.length ?? 0) > 0;
}

export type BeginResult = { kind: "ok"; lead: Lead } | { kind: "not-found" } | { kind: "legacy" };

/**
 * Fast path write: store the provisional (rule-based) tag/reason/date, mark the lead
 * pending and return the updated row in the same round trip. The draft is left
 * untouched. "legacy" means the database has no analysis columns yet and nothing
 * was written, so the caller should use the synchronous path.
 */
export async function beginAnalysis(
  sb: SupabaseClient,
  leadId: string,
  provisional: AgentResult,
  startedAt: string,
  lastContactDate?: string,
): Promise<BeginResult> {
  if (analysisColumnsMissing()) return { kind: "legacy" };
  const patch: Record<string, string> = {
    tag: provisional.tag,
    reason: provisional.reason,
    follow_up_date: provisional.followUpDate,
    analysis_status: "pending",
    analysis_started_at: startedAt,
  };
  if (lastContactDate) patch.last_contact_date = lastContactDate;
  const res = await sb.from("leads").update(patch).eq("id", leadId).select(LEAD_COLS_V2);
  if (isMissingColumn(res.error)) {
    markColumnsMissing();
    return { kind: "legacy" };
  }
  fail(res.error);
  const row = res.data?.[0];
  return row ? { kind: "ok", lead: mapLead(row as unknown as LeadRow) } : { kind: "not-found" };
}

/**
 * Final write: the model (or fallback) result, marking the lead ready. Guarded by
 * analysis_started_at so a slower, superseded analysis never overwrites a newer one.
 * Returns whether a row was written.
 */
export async function finishAnalysis(
  sb: SupabaseClient,
  leadId: string,
  a: AgentResult,
  startedAt: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("leads")
    .update({ ...leadToRow(a), analysis_status: "ready" })
    .eq("id", leadId)
    .eq("analysis_started_at", startedAt)
    .select("id");
  fail(error);
  return (data?.length ?? 0) > 0;
}

/** Last resort when the final write failed: never leave the lead pending. */
export async function markReady(sb: SupabaseClient, leadId: string, startedAt: string): Promise<void> {
  const { error } = await sb
    .from("leads")
    .update({ analysis_status: "ready" })
    .eq("id", leadId)
    .eq("analysis_started_at", startedAt);
  fail(error);
}
