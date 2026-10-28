import { createServerSupabase } from "@/lib/supabase/server";
import { addMessage, getLead } from "@/lib/repo";
import { todayIST } from "@/lib/dates";
import { validateMessage } from "@/lib/validate";
import { reanalyze } from "@/lib/chat";
import { HttpError, json, leadIdFrom, readJson, requireUser, withErrors } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const sb = await createServerSupabase();
  await requireUser(sb);
  const id = await leadIdFrom(ctx);
  const v = validateMessage(await readJson(req));
  if (!v.ok) throw new HttpError(400, v.error);
  if (!(await getLead(sb, id))) throw new HttpError(404, "Lead not found");
  if (!(await addMessage(sb, id, v.value.from, v.value.text))) {
    throw new HttpError(404, "Lead not found");
  }
  const lastContact = v.value.from === "buyer" ? todayIST() : undefined;
  return json(await reanalyze(sb, id, lastContact));
});
