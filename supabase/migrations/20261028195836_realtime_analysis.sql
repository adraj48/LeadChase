-- Fast writes + pushed analysis: track whether the model result for a lead is still
-- being computed, and publish lead changes over Supabase Realtime (a managed
-- WebSocket) so the browser receives the final tag, date and draft without polling.
-- Safe to run more than once.

-- 'pending': a provisional (rule-based) tag/date is stored and the model is still
-- writing the final draft. 'ready': the stored result is final.
-- analysis_started_at doubles as a per-analysis counter: every new message or send
-- stamps a newer value, so clients can drop out-of-order events and a reader can
-- treat a row stuck in 'pending' for too long (killed function) as ready.
alter table public.leads
  add column if not exists analysis_status text not null default 'ready'
    check (analysis_status in ('pending', 'ready')),
  add column if not exists analysis_started_at timestamptz;

-- Publish lead row changes. Realtime postgres_changes evaluates the existing RLS
-- policies (leads_select) for every subscriber, so a rep only receives events for
-- their own leads and the owner (app_metadata.role) for all of them. RLS, grants
-- and policies are intentionally unchanged: authenticated already has select,
-- insert and update on public.leads, and the new columns are covered by those
-- table-level grants. Messages are not published (the API response carries them).
--
-- REPLICA IDENTITY stays at the default (primary key). The client only reads the
-- NEW row of an UPDATE and filters on the primary key (id), and RLS is checked
-- against the new row, so FULL is not needed (it would only add WAL volume).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'leads'
     ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
