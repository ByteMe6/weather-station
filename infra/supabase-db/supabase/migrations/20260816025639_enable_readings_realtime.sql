-- MRP-25: the dashboard subscribes to postgres_changes on readings, filtered
-- by device_id. RLS ("device members can view readings") is applied to
-- Realtime deliveries for the authenticated role, so a subscriber only ever
-- receives rows for devices they are linked to (proven by
-- tests/realtime_publication.sql, which replays realtime.apply_rls).
--
-- Guarded: `alter publication … add table` raises 42710 if the table was
-- already toggled on in Studio on a hosted project.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'readings'
  ) then
    alter publication supabase_realtime add table public.readings;
  end if;
end $$;
