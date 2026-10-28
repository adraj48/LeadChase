import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Message, Rep } from "@/lib/types";
import type { AgentResult } from "@/lib/agent";
import { leadToRow, mapLead, mapMessage, mapRep } from "@/lib/mappers";

export interface NewLeadInput {
  name: string;
  company: string;
  phone: string;
  source: string;
  lastContactDate: string;
  repId?: string; // owner only; RLS rejects other values for reps
}

const LEAD_COLS =
  "id, rep_id, name, company, phone, source, last_contact_date, tag, reason, follow_up_date, draft, analysis_source, reps(name)";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(`Supabase error: ${error.message}`);
}

export async function getCurrentRep(sb: SupabaseClient): Promise<Rep | null> {
  const { data: auth, error: authErr } = await sb.auth.getUser();
  // No session is not an error; the caller redirects to login.
  if (authErr || !auth.user) return null;
  const { data, error } = await sb
    .from("reps")
    .select("id, name, email, role")
    .eq("id", auth.user.id)
    .maybeSingle();
  fail(error);
  return data ? mapRep(data) : null;
}

export async function listReps(sb: SupabaseClient): Promise<Rep[]> {
  const { data, error } = await sb.from("reps").select("id, name, email, role").order("name");
  fail(error);
  return (data ?? []).map(mapRep);
}

export async function listLeads(sb: SupabaseClient, filterRepId?: string): Promise<Lead[]> {
  let q = sb.from("leads").select(LEAD_COLS);
  if (filterRepId) q = q.eq("rep_id", filterRepId);
  const { data, error } = await q.order("follow_up_date", { ascending: true });
  fail(error);
  return (data ?? []).map(mapLead);
}

export async function getLead(
  sb: SupabaseClient,
  id: string,
): Promise<{ lead: Lead; messages: Message[] } | null> {
  const { data, error } = await sb.from("leads").select(LEAD_COLS).eq("id", id).maybeSingle();
  fail(error);
  if (!data) return null; // missing or hidden by RLS
  const { data: msgs, error: mErr } = await sb
    .from("messages")
    .select("id, lead_id, sender, body, sent_at")
    .eq("lead_id", id)
    .order("sent_at", { ascending: true });
  fail(mErr);
  return { lead: mapLead(data), messages: (msgs ?? []).map(mapMessage) };
}

export async function createLead(
  sb: SupabaseClient,
  repId: string,
  input: NewLeadInput,
  a: AgentResult,
): Promise<Lead> {
  const { data, error } = await sb
    .from("leads")
    .insert({
      rep_id: input.repId ?? repId,
      name: input.name,
      company: input.company,
      phone: input.phone,
      source: input.source,
      last_contact_date: input.lastContactDate,
      ...leadToRow(a),
    })
    .select(LEAD_COLS)
    .single();
  fail(error);
  return mapLead(data!);
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
    .select("id, lead_id, sender, body, sent_at")
    .single();
  // 42501 = RLS with-check violation: the parent lead is not visible to this user.
  if (error && error.code === "42501") return null;
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
