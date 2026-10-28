import { getServerSupabase } from "@/lib/supabase/server";
import { todayIST } from "@/lib/dates";
import { validateMessage } from "@/lib/validate";
import { addAndAnalyze } from "@/lib/chat";
import { HttpError, json, leadIdFrom, readJson, withErrors } from "@/lib/http";

// The model runs after the response (see addAndAnalyze), so keep the budget.
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const id = await leadIdFrom(ctx);
  const v = validateMessage(await readJson(req));
  if (!v.ok) throw new HttpError(400, v.error);
  const lastContact = v.value.from === "buyer" ? todayIST() : undefined;
  return json(await addAndAnalyze(getServerSupabase(), id, v.value, lastContact, "POST messages"));
});
