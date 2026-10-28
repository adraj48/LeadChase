// RLS smoke check. Uses ONLY the publishable key and signs in as seeded demo users.
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addMessage, getCurrentRep, getLead, listLeads, saveDraft, createLead } from "../src/lib/repo";
import { SEED_LEADS } from "./seed-data";
import { todayIST } from "../src/lib/dates";

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

const url = must("NEXT_PUBLIC_SUPABASE_URL");
const key = must("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

async function signIn(email: string): Promise<SupabaseClient> {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: "demo1234" });
  if (error) {
    console.error(`Could not sign in as ${email}: ${error.message}. Has the seed been run?`);
    process.exit(1);
  }
  return sb;
}

async function main() {
  // Owner first, only to learn ids and a baseline to prove nothing changes later.
  const owner = await signIn("owner@axon.demo");
  console.log("owner");
  const ownerRep = await getCurrentRep(owner);
  assert(ownerRep?.role === "owner", "getCurrentRep returns the owner row");
  const all = await listLeads(owner);
  assert(all.length === SEED_LEADS.length, `owner sees all ${SEED_LEADS.length} leads (saw ${all.length})`);

  const rep1 = await signIn("rep1@axon.demo");
  console.log("rep1");
  const me = await getCurrentRep(rep1);
  assert(me?.email === "rep1@axon.demo", "getCurrentRep returns rep1");
  const mine = await listLeads(rep1);
  assert(mine.length > 0, `sees > 0 leads (saw ${mine.length})`);
  assert(mine.every((l) => l.repId === me!.id), "every visible lead belongs to rep1");
  assert(mine.length < all.length, "sees fewer leads than the owner");

  const other = all.find((l) => l.repId !== me!.id)!;
  const before = await getLead(owner, other.id);
  assert((await getLead(rep1, other.id)) === null, "getLead on another rep's lead returns null");
  assert((await saveDraft(rep1, other.id, "HACKED")) === false, "saveDraft on another rep's lead returns false");
  assert((await addMessage(rep1, other.id, "rep", "HACKED")) === null, "addMessage on another rep's lead returns null");
  let insertBlocked = false;
  try {
    await createLead(
      rep1,
      other.repId,
      { name: "x", company: "x", phone: "+91 98000 00000", source: "Website", lastContactDate: todayIST() },
      { tag: "Cold", reason: "x", followUpDate: todayIST(), draft: "x", analysisSource: "fallback" },
    );
  } catch {
    insertBlocked = true;
  }
  assert(insertBlocked, "cannot create a lead owned by another rep");
  const after = await getLead(owner, other.id);
  assert(
    before !== null && after !== null &&
      before.lead.draft === after.lead.draft && before.messages.length === after.messages.length,
    "other rep's lead draft and messages unchanged",
  );

  const own = mine[0];
  const ownDetail = await getLead(rep1, own.id);
  assert(ownDetail !== null, "getLead on own lead works");

  // Anonymous (no session) must not read anything.
  const anon = createClient(url, key, { auth: { persistSession: false } });
  let anonRows = 0;
  try {
    anonRows = (await listLeads(anon)).length;
  } catch {
    anonRows = 0;
  }
  assert(anonRows === 0, "anonymous client reads no leads");

  if (failures > 0) {
    console.error(`\nRLS check FAILED: ${failures} assertion(s).`);
    process.exit(1);
  }
  console.log("\nRLS check passed.");
}

main().catch((e) => {
  console.error("RLS check crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
