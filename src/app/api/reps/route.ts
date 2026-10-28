import { getServerSupabase } from "@/lib/supabase/server";
import { listReps } from "@/lib/repo";
import { json, withErrors } from "@/lib/http";
import { stageTimer } from "@/lib/timing";

// The sales reps for the rep picker, sorted by name: { reps: { id, name }[] }.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const GET = withErrors(async (_req: Request) => {
  const timer = stageTimer("GET reps");
  const reps = await listReps(getServerSupabase());
  timer.mark("reps");
  timer.done();
  return json({ reps });
});
