import { getServerSupabase } from "@/lib/supabase/server";
import { getLead } from "@/lib/repo";
import { stageTimer } from "@/lib/timing";
import { HttpError, json, leadIdFrom, withErrors } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/leads/[id] -> { lead, messages }, read in one database request.
export const GET = withErrors(async (_req: Request, ctx: Ctx) => {
  const timer = stageTimer("GET lead");
  const id = await leadIdFrom(ctx);
  const found = await getLead(getServerSupabase(), id);
  timer.mark("lead+messages");
  if (!found) throw new HttpError(404, "Lead not found");
  const res = json(found);
  timer.mark("respond");
  timer.done();
  return res;
});
