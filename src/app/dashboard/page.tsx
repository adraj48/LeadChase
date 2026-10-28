// placeholder — replaced in Task 7
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentRep } from "@/lib/repo";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const sb = await createServerSupabase();
  // Table may be missing/unseeded early on; fall back to the auth email.
  const rep = await getCurrentRep(sb).catch(() => null);
  let label = "Signed in";
  if (rep) {
    label = `Signed in as ${rep.name} (${rep.role})`;
  } else {
    const { data } = await sb.auth.getUser();
    if (data.user?.email) label = `Signed in as ${data.user.email}`;
  }
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
        <p className="text-gray-900">{label}</p>
        <LogoutButton />
      </div>
    </main>
  );
}
