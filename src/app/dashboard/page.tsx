import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentRep } from "@/lib/repo";
import type { Rep } from "@/lib/types";
import { Dashboard } from "./Dashboard";

export default async function DashboardPage() {
  // Never let a Supabase outage turn into a 500; the client list shows its own banner.
  let me: Pick<Rep, "name" | "role"> = { name: "Signed in", role: "rep" };
  try {
    const sb = await createServerSupabase();
    // Table may be missing/unseeded early on; fall back to the auth email.
    const rep = await getCurrentRep(sb).catch(() => null);
    if (rep) {
      me = { name: rep.name, role: rep.role };
    } else {
      const { data } = await sb.auth.getUser();
      if (data.user?.email) me = { name: data.user.email, role: "rep" };
    }
  } catch {
    // keep generic fallback
  }
  return <Dashboard me={me} />;
}
