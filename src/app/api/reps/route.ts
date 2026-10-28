import { createServerSupabase } from "@/lib/supabase/server";
import { listReps } from "@/lib/repo";
import { json, requireUser, withErrors } from "@/lib/http";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const GET = withErrors(async (_req: Request) => {
  const sb = await createServerSupabase();
  await requireUser(sb);
  return json({ reps: await listReps(sb) });
});
