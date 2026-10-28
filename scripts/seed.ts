// Idempotent demo seed. Uses the SERVICE-ROLE key: run locally only. Requires the
// open_demo_access migration (reps are plain rows, not auth accounts).
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { addDays, todayIST } from "../src/lib/dates";
import { SEED_LEADS as HAND_LEADS, SEED_REPS } from "./seed-data";
import { BULK_LEADS } from "./seed-bulk";

config({ path: ".env.local" });

// 24 hand-written leads + 126 deterministic generated ones (rep1/2/3/5 only).
const SEED_LEADS = [...HAND_LEADS, ...BULK_LEADS];

// Earlier versions created login accounts with this domain (and a published demo
// password). They are deleted on every run so none of them can sign in any more.
const DEMO_DOMAIN = "@axon.demo";

function must(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}. Set it in .env.local before running the seed.`);
    process.exit(1);
  }
  return v;
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) {
    console.error(`Seed failed at "${what}": ${res.error.message}`);
    process.exit(1);
  }
  return res.data;
}

const MIGRATION_HINT =
  "The reps table still references auth.users, so the open_demo_access migration has not been applied.\n" +
  "Apply it first (npx supabase db push, or paste supabase/migrations/*_open_demo_access.sql into the SQL editor), then run npm run seed again. Nothing was changed.";

async function main() {
  const sb = createClient(must("NEXT_PUBLIC_SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const today = todayIST();

  // 0. Preflight before touching anything: a rep row with a random id only inserts once
  //    the reps -> auth.users foreign key is gone. The probe row is removed right away.
  const probeId = randomUUID();
  const probe = await sb
    .from("reps")
    .insert({ id: probeId, name: "seed preflight", email: `preflight-${probeId}@seed.invalid`, role: "rep" });
  if (probe.error) {
    if (probe.error.code === "23503" || /foreign key/i.test(probe.error.message)) {
      console.error(MIGRATION_HINT);
    } else {
      console.error(`Seed failed at "preflight": ${probe.error.message}`);
    }
    process.exit(1);
  }
  check(await sb.from("reps").delete().eq("id", probeId), "remove preflight row");

  // 1. Delete leftover demo login accounts (no accounts with the old known password).
  const demoUserIds: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`Seed failed at "list users": ${error.message}`);
      process.exit(1);
    }
    for (const u of data.users) if (u.email?.toLowerCase().endsWith(DEMO_DOMAIN)) demoUserIds.push(u.id);
    if (data.users.length < 200) break;
  }
  for (const id of demoUserIds) {
    const { error } = await sb.auth.admin.deleteUser(id);
    if (error) {
      console.error(`Seed failed at "delete user": ${error.message}`);
      process.exit(1);
    }
  }
  const deletedUsers = demoUserIds.length;

  // 2. Remove old demo data: leads (messages cascade), then every reps row that is not
  //    one of the five fixed reps (the retired owner row, ids of old auth accounts).
  check(await sb.from("leads").delete().not("id", "is", null), "delete leads");
  const keep = SEED_REPS.map((r) => r.id);
  check(await sb.from("reps").delete().not("id", "in", `(${keep.join(",")})`), "delete old reps");

  // 3. The five reps, with explicit ids (upsert: re-running changes nothing).
  check(
    await sb
      .from("reps")
      .upsert(SEED_REPS.map((r) => ({ id: r.id, name: r.name, email: r.email, role: "rep" })), { onConflict: "id" }),
    "upsert reps",
  );
  const idByEmail = new Map(SEED_REPS.map((r) => [r.email, r.id]));

  // 3. Leads, then messages, resolving day offsets against today (IST).
  const inserted = check(
    await sb
      .from("leads")
      .insert(
        SEED_LEADS.map((l) => ({
          rep_id: idByEmail.get(l.repEmail)!,
          name: l.name,
          company: l.company,
          phone: l.phone,
          source: l.source,
          last_contact_date: addDays(today, l.lastContactOffset),
          tag: l.tag,
          reason: l.reason,
          follow_up_date: addDays(today, l.followUpOffset),
          draft: l.draft,
          analysis_source: "seed",
        })),
      )
      .select("id, phone"),
    "insert leads",
  );
  const idByPhone = new Map(inserted!.map((row) => [row.phone as string, row.id as string]));

  const messages = SEED_LEADS.flatMap((l) =>
    l.messages.map((m) => ({
      lead_id: idByPhone.get(l.phone)!,
      sender: m.from,
      body: m.text,
      sent_at: `${addDays(today, m.dayOffset)}T${m.time}:00+05:30`,
    })),
  );
  check(await sb.from("messages").insert(messages), "insert messages");

  console.log(`Deleted ${deletedUsers} demo login account(s).`);
  console.log(`Seeded ${SEED_REPS.length} reps, ${SEED_LEADS.length} leads, ${messages.length} messages (today = ${today}).`);
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
