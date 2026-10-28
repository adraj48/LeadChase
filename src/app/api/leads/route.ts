import { getServerSupabase } from "@/lib/supabase/server";
import { createLead, getRep, listLeads } from "@/lib/repo";
import { analyzeLead } from "@/lib/agent";
import { todayIST } from "@/lib/dates";
import { sortByUrgency } from "@/lib/urgency";
import { validateNewLead } from "@/lib/validate";
import { ALL_REPS_VIEWER, parseRepScope } from "@/lib/access";
import { stageTimer } from "@/lib/timing";
import { HttpError, json, readJson, withErrors } from "@/lib/http";

export const maxDuration = 60;

// GET /api/leads?rep=<uuid|all> (default all) -> { today, me, leads }. `me` is always
// ALL_REPS_VIEWER: there is no login, it is kept so the response keeps its shape.
export const GET = withErrors(async (req: Request) => {
  const timer = stageTimer("GET leads");
  const scope = parseRepScope(new URL(req.url).searchParams.get("rep"));
  if (scope.kind === "invalid") throw new HttpError(400, "Invalid rep");
  const sb = getServerSupabase();
  const repId = scope.kind === "rep" ? scope.repId : undefined;
  const today = todayIST();
  const leads = await listLeads(sb, repId);
  timer.mark("leads");
  // An empty list for one rep may mean the id is unknown: only then is a lookup needed.
  if (repId && leads.length === 0 && !(await getRep(sb, repId))) {
    throw new HttpError(400, "Unknown rep");
  }
  const out = json({ today, me: ALL_REPS_VIEWER, leads: sortByUrgency(leads, today) });
  timer.mark("respond");
  timer.done();
  return out;
});

// POST /api/leads: body as before plus a required repId (uuid of an existing rep).
export const POST = withErrors(async (req: Request) => {
  const timer = stageTimer("POST leads");
  const body = await readJson(req);
  const today = todayIST();
  const v = validateNewLead(body, today);
  if (!v.ok) throw new HttpError(400, v.error);
  const input = v.value;
  const sb = getServerSupabase();
  // Checked before the model call, so an unknown rep never costs model quota.
  const rep = await getRep(sb, input.repId);
  timer.mark("rep");
  if (!rep) throw new HttpError(400, "Unknown rep");
  const analysis = await analyzeLead({ lead: input, messages: [], today, repName: rep.name });
  timer.mark("analysis");
  try {
    const lead = await createLead(sb, input, analysis);
    timer.mark("insert");
    timer.done();
    return json(lead, 201);
  } catch (e) {
    // The rep was deleted between the lookup and the insert.
    if (e instanceof Error && /foreign key|23503/i.test(e.message)) {
      throw new HttpError(400, "Unknown rep");
    }
    throw e;
  }
});
