import { createServerSupabase } from "@/lib/supabase/server";
import { getLead } from "@/lib/repo";
import { HttpError, json, leadIdFrom, requireUser, withErrors } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrors(async (_req: Request, ctx: Ctx) => {
  const sb = await createServerSupabase();
  await requireUser(sb);
  const id = await leadIdFrom(ctx);
  const found = await getLead(sb, id);
  if (!found) throw new HttpError(404, "Lead not found");
  return json(found);
});
