// Demo-mode access check (open_demo_access migration). Uses ONLY the publishable key,
// with no session, i.e. exactly what any browser has. Expected:
//   - anon can read public.leads (needed for Realtime);
//   - anon cannot read reps or messages;
//   - anon cannot insert, update or delete anything.
// Every write probe targets a row that does not exist or would violate a constraint, so
// nothing is changed even if a protection were missing; such a gap shows up as an error
// code other than 42501 (or no error at all) and fails the check.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}. Set it in .env.local.`);
    process.exit(1);
  }
  return v;
}

const NO_ROW = "00000000-0000-4000-8000-000000000000";
type Res = { data: unknown; error: { code?: string; message: string } | null };

// 42501 = insufficient privilege or row-level security violation: denied either way.
const denied = (r: Res) => r.error?.code === "42501";
const describe = (r: Res) => (r.error ? `${r.error.code ?? "?"} ${r.error.message}` : "no error");
// A denied read is either a privilege error or zero rows.
const readsNothing = (r: Res) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);

async function main() {
  const anon = createClient(must("NEXT_PUBLIC_SUPABASE_URL"), must("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("reads");
  const leads = await anon.from("leads").select("id, rep_id, tag, analysis_status").limit(5);
  assert(!leads.error && (leads.data?.length ?? 0) > 0, `anon reads leads (${describe(leads)}, ${leads.data?.length ?? 0} rows)`);
  const reps = await anon.from("reps").select("id").limit(5);
  assert(readsNothing(reps), `anon cannot read reps (${describe(reps)})`);
  const messages = await anon.from("messages").select("id").limit(5);
  assert(readsNothing(messages), `anon cannot read messages (${describe(messages)})`);

  console.log("writes");
  const leadInsert = await anon.from("leads").insert({
    rep_id: NO_ROW, // unknown rep: a foreign key error if the insert were ever allowed
    name: "rls-check",
    company: "rls-check",
    phone: "+91 90000 00000",
    source: "Website",
    last_contact_date: "2026-01-01",
    tag: "Cold",
    reason: "rls-check",
    follow_up_date: "2026-01-08",
    draft: "rls-check",
    analysis_source: "fallback",
  });
  assert(denied(leadInsert), `anon cannot insert leads (${describe(leadInsert)})`);
  const leadUpdate = await anon.from("leads").update({ draft: "rls-check" }).eq("id", NO_ROW);
  assert(denied(leadUpdate), `anon cannot update leads (${describe(leadUpdate)})`);
  const leadDelete = await anon.from("leads").delete().eq("id", NO_ROW);
  assert(denied(leadDelete), `anon cannot delete leads (${describe(leadDelete)})`);

  const msgInsert = await anon.from("messages").insert({ lead_id: NO_ROW, sender: "rep", body: "rls-check" });
  assert(denied(msgInsert), `anon cannot insert messages (${describe(msgInsert)})`);
  const msgUpdate = await anon.from("messages").update({ body: "rls-check" }).eq("id", NO_ROW);
  assert(denied(msgUpdate), `anon cannot update messages (${describe(msgUpdate)})`);
  const msgDelete = await anon.from("messages").delete().eq("id", NO_ROW);
  assert(denied(msgDelete), `anon cannot delete messages (${describe(msgDelete)})`);

  // No name: a not-null error if the insert were ever allowed.
  const repInsert = await anon.from("reps").insert({ id: NO_ROW, email: "rls-check@seed.invalid", role: "rep" });
  assert(denied(repInsert), `anon cannot insert reps (${describe(repInsert)})`);
  const repUpdate = await anon.from("reps").update({ name: "rls-check" }).eq("id", NO_ROW);
  assert(denied(repUpdate), `anon cannot update reps (${describe(repUpdate)})`);
  const repDelete = await anon.from("reps").delete().eq("id", NO_ROW);
  assert(denied(repDelete), `anon cannot delete reps (${describe(repDelete)})`);

  if (failures > 0) {
    console.error(`\nAccess check FAILED: ${failures} assertion(s). Has the open_demo_access migration been applied?`);
    process.exit(1);
  }
  console.log("\nAccess check passed.");
}

main().catch((e) => {
  console.error("Access check crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
