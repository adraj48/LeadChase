import type { SupabaseClient } from "@supabase/supabase-js";
import { getLead, saveAnalysis } from "@/lib/repo";
import { analyzeLead } from "@/lib/agent";
import { todayIST } from "@/lib/dates";
import { HttpError } from "@/lib/http";

// Re-analyze the full chat, persist the result and return the re-read chat.
export async function reanalyze(sb: SupabaseClient, id: string, lastContactDate?: string) {
  const chat = await getLead(sb, id);
  if (!chat) throw new HttpError(404, "Lead not found");
  const analysis = await analyzeLead({
    lead: {
      name: chat.lead.name,
      company: chat.lead.company,
      source: chat.lead.source,
      lastContactDate: lastContactDate ?? chat.lead.lastContactDate,
    },
    messages: chat.messages.map((m) => ({ from: m.from, text: m.text, at: m.at })),
    today: todayIST(),
  });
  if (!(await saveAnalysis(sb, id, analysis, lastContactDate))) {
    throw new HttpError(404, "Lead not found");
  }
  const fresh = await getLead(sb, id);
  if (!fresh) throw new HttpError(404, "Lead not found");
  return fresh;
}
