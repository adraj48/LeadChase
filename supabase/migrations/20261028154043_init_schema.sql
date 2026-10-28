-- Lead follow-up agent: schema, grants and row level security.
-- Owner-ness comes from app_metadata.role (only settable by the service role),
-- never user_metadata. No SECURITY DEFINER functions, no views.

create table public.reps (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  email text not null unique,
  role text not null check (role in ('rep','owner'))
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id),
  name text not null,
  company text not null,
  phone text not null,
  source text not null,
  last_contact_date date not null,
  tag text not null check (tag in ('Hot','Warm','Cold')),
  reason text not null,
  follow_up_date date not null,
  draft text not null,
  analysis_source text not null check (analysis_source in ('llm','fallback','seed')),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  sender text not null check (sender in ('rep','buyer')),
  body text not null check (length(trim(body)) > 0),
  sent_at timestamptz not null default now()
);

create index leads_rep_id_idx on public.leads (rep_id);
create index messages_lead_id_sent_at_idx on public.messages (lead_id, sent_at);

alter table public.reps enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;

-- Neutralise any default privileges the project auto-grants on new tables, then
-- grant exactly what is needed.
revoke all on public.reps, public.leads, public.messages from anon;
revoke all on public.reps, public.leads, public.messages from authenticated;
-- authenticated: read reps; read/insert/update leads; read/insert messages
-- (no delete anywhere, messages are append-only, reps are read-only)
grant select on public.reps to authenticated;
grant select, insert, update on public.leads to authenticated;
grant select, insert on public.messages to authenticated;
-- service_role (seed script only; bypasses RLS) needs explicit table privileges
grant select, insert, update, delete on public.reps, public.leads, public.messages to service_role;

-- owner predicate: ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner'
create policy reps_select on public.reps for select to authenticated
  using (id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');

create policy leads_select on public.leads for select to authenticated
  using (rep_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');
create policy leads_insert on public.leads for insert to authenticated
  with check (rep_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');
create policy leads_update on public.leads for update to authenticated
  using (rep_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (rep_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');

-- messages: visibility follows the parent lead (leads RLS applies inside the subquery,
-- which runs as the querying user). Messages are append-only: no update/delete.
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.leads l where l.id = messages.lead_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (exists (select 1 from public.leads l where l.id = messages.lead_id));
