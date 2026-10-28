import { createServerSupabase } from "@/lib/supabase/server";
import { addMessage, getLead } from "@/lib/repo";
import { todayIST } from "@/lib/dates";
import { validateText } from "@/lib/validate";
import { isDuplicateOfLatest, reanalyze } from "@/lib/chat";
import { HttpError, json, leadIdFrom, readJson, requireUser, withErrors } from "@/lib/http";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const sb = await createServerSupabase();
  await requireUser(sb);
  const id = await leadIdFrom(ctx);
  const v = validateText(await readJson(req), "draft");
  if (!v.ok) throw new HttpError(400, v.error);
  const existing = await getLead(sb, id);
  if (!existing) throw new HttpError(404, "Lead not found");
  if (!isDuplicateOfLatest(existing.messages, "rep", v.value)) {
    if (!(await addMessage(sb, id, "rep", v.value))) throw new HttpError(404, "Lead not found");
  }
  return json(await reanalyze(sb, id, todayIST()));
});
