import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentRep } from "@/lib/repo";
import type { Rep } from "@/lib/types";
import { Dashboard } from "./Dashboard";

export default async function DashboardPage() {
  const sb = await createServerSupabase();
  // Table may be missing/unseeded early on; fall back to the auth email.
  const rep = await getCurrentRep(sb).catch(() => null);
  let me: Pick<Rep, "name" | "role">;
  if (rep) {
    me = { name: rep.name, role: rep.role };
  } else {
    const { data } = await sb.auth.getUser();
    me = { name: data.user?.email ?? "Signed in", role: "rep" };
  }
  return <Dashboard me={me} />;
}
