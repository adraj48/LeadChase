// Idempotent demo seed. Uses the SERVICE-ROLE key: run locally only, never from app code.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { addDays, todayIST } from "../src/lib/dates";
import { SEED_LEADS, SEED_REPS } from "./seed-data";

config({ path: ".env.local" });

const DEMO_DOMAIN = "@axon.demo";
const DEMO_PASSWORD = "demo1234";

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

async function main() {
  const sb = createClient(must("NEXT_PUBLIC_SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const today = todayIST();

  // 1. Remove old demo data: leads first (messages cascade; leads reference reps), then users (reps cascade).
  check(await sb.from("leads").delete().not("id", "is", null), "delete leads");
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`Seed failed at "list users": ${error.message}`);
      process.exit(1);
    }
    const demo = data.users.filter((u) => u.email?.endsWith(DEMO_DOMAIN));
    for (const u of demo) {
      const { error: delErr } = await sb.auth.admin.deleteUser(u.id);
      if (delErr) {
        console.error(`Seed failed at "delete user": ${delErr.message}`);
        process.exit(1);
      }
    }
    if (data.users.length < 200) break;
  }

  // 2. Create auth users (app_metadata.role is what RLS trusts) and reps rows.
  const idByEmail = new Map<string, string>();
  for (const rep of SEED_REPS) {
    const { data, error } = await sb.auth.admin.createUser({
      email: rep.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: { role: rep.role },
    });
    if (error || !data.user) {
      console.error(`Seed failed at "create user": ${error?.message ?? "no user returned"}`);
      process.exit(1);
    }
    idByEmail.set(rep.email, data.user.id);
  }
  check(
    await sb.from("reps").insert(
      SEED_REPS.map((r) => ({ id: idByEmail.get(r.email)!, name: r.name, email: r.email, role: r.role })),
    ),
    "insert reps",
  );

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

  console.log(`Seeded ${SEED_REPS.length} users, ${SEED_LEADS.length} leads, ${messages.length} messages (today = ${today}).`);
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
