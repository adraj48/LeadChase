import { createServerSupabase } from "@/lib/supabase/server";
import { createLead, listLeads, listReps } from "@/lib/repo";
import { analyzeLead } from "@/lib/agent";
import { todayIST } from "@/lib/dates";
import { sortByUrgency } from "@/lib/urgency";
import { validateNewLead } from "@/lib/validate";
import { HttpError, UUID_RE, json, readJson, requireUser, withErrors } from "@/lib/http";

export const maxDuration = 60;

export const GET = withErrors(async (req: Request) => {
  const sb = await createServerSupabase();
  const me = await requireUser(sb);
  const rep = new URL(req.url).searchParams.get("rep");
  // Only the owner may filter by rep; RLS scopes reps anyway.
  const filter = me.role === "owner" && rep && UUID_RE.test(rep) ? rep : undefined;
  const today = todayIST();
  const leads = await listLeads(sb, filter);
  return json({ today, me, leads: sortByUrgency(leads, today) });
});

export const POST = withErrors(async (req: Request) => {
  const sb = await createServerSupabase();
  const me = await requireUser(sb);
  const body = await readJson(req);
  const today = todayIST();
  const v = validateNewLead(body, today);
  if (!v.ok) throw new HttpError(400, v.error);
  const input = v.value;
  const repId = me.role === "owner" ? (input.repId ?? me.id) : me.id;
  if (!UUID_RE.test(repId)) throw new HttpError(400, "Unknown rep");
  let repName: string | undefined = me.id === repId ? me.name : undefined;
  if (!repName) {
    // Owner creating for another rep: best-effort name lookup, never blocks creation.
    try {
      repName = (await listReps(sb)).find((r) => r.id === repId)?.name;
    } catch {
      repName = undefined;
    }
  }
  const analysis = await analyzeLead({ lead: input, messages: [], today, repName });
  try {
    const lead = await createLead(sb, repId, { ...input, repId }, analysis);
    return json(lead, 201);
  } catch (e) {
    if (e instanceof Error && /foreign key|23503/i.test(e.message)) {
      throw new HttpError(400, "Unknown rep");
    }
    throw e;
  }
});
