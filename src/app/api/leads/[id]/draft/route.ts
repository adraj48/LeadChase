import { createServerSupabase } from "@/lib/supabase/server";
import { saveDraft } from "@/lib/repo";
import { validateText } from "@/lib/validate";
import { HttpError, json, leadIdFrom, readJson, requireUser, withErrors } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withErrors(async (req: Request, ctx: Ctx) => {
  const sb = await createServerSupabase();
  await requireUser(sb);
  const id = await leadIdFrom(ctx);
  const v = validateText(await readJson(req), "draft");
  if (!v.ok) throw new HttpError(400, v.error);
  if (!(await saveDraft(sb, id, v.value))) throw new HttpError(404, "Lead not found");
  return json({ ok: true });
});
