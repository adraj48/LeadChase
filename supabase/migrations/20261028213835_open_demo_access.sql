-- Open demo access: the app has no login (out of scope for the take-home brief).
--
-- Security model in demo mode
--   * All data is fake demo data (reps, leads, chats).
--   * WRITES happen only through the Next.js API routes, which validate every input
--     and use the service-role key on the server (service_role bypasses RLS; the key
--     is never sent to the browser). No browser role may write anything.
--   * READS of public.leads are public by design: the browser subscribes to Supabase
--     Realtime postgres_changes on public.leads with the publishable (anon) key, and
--     Realtime only delivers rows the subscriber may SELECT under RLS.
--   * reps and messages are not readable with the publishable key at all; the API
--     serves them.
--   * RLS stays ENABLED on all three tables, so any future grant still needs an
--     explicit policy before it exposes a row.
--
-- Safe to run more than once. Must be applied after 20261028195836_realtime_analysis
-- (its Realtime publication of public.leads is kept as is).

-- 1. Reps are plain rows now, not auth accounts: drop the foreign key from
--    public.reps.id to auth.users (whatever its name) and let ids default.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.reps'::regclass
      and con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.reps drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.reps alter column id set default gen_random_uuid();
-- There is no owner account any more ("All reps" is just a filter); new rows are reps.
alter table public.reps alter column role set default 'rep';

-- 2. Drop the policies written for signed-in users (authenticated role, auth.uid() /
--    app_metadata ownership). The init migration created no helper functions for them.
drop policy if exists reps_select on public.reps;
drop policy if exists leads_select on public.leads;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_update on public.leads;
drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;

-- 3. RLS stays on everywhere (idempotent).
alter table public.reps enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;

-- 4. Table privileges: nothing for the browser roles except reading leads.
revoke all on public.reps, public.leads, public.messages from anon;
revoke all on public.reps, public.leads, public.messages from authenticated;
grant select on public.leads to anon;
-- The API (and the seed script) use service_role, which bypasses RLS but still needs
-- table privileges. Same as the init migration; repeated so this file stands alone.
grant select, insert, update, delete on public.reps, public.leads, public.messages to service_role;

-- 5. The one policy: anon may read leads (fake demo data, needed for Realtime).
--    No insert/update/delete policy exists for anon or authenticated, and neither role
--    has those privileges, so browser writes fail twice over.
drop policy if exists leads_select_demo on public.leads;
create policy leads_select_demo on public.leads
  for select
  to anon
  using (true);
