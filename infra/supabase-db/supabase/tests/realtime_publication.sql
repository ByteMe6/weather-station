begin;
select plan(6);

-- 1) publication membership + the invariants Realtime relies on
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'readings'
  ),
  'readings is published to supabase_realtime'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.readings'::regclass),
  'readings keeps RLS enabled while published'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.readings'::regclass and contype = 'p'),
  'readings has a primary key (required by realtime.apply_rls)'
);

-- 2) replay realtime.apply_rls (walrus) to prove deliveries are RLS-filtered
insert into public.users (id, clerk_user_id) values
  ('11111111-1111-1111-1111-111111111111', 'user_a'),
  ('22222222-2222-2222-2222-222222222222', 'user_b');
insert into public.devices (device_id, secret, status) values ('ws-rt0000000001', 'secret-a', 'registered');
insert into public.device_users (device_id, user_id, role) values ('ws-rt0000000001', '11111111-1111-1111-1111-111111111111', 'owner');
insert into public.readings (device_id, timestamp, temperature, humidity, pressure)
  values ('ws-rt0000000001', '2026-08-16T00:00:00Z', 20, 50, 1013);

-- exactly what useReadingsRealtime opens: event INSERT, filter device_id=eq.<id>;
-- B is malicious (filters on A's device); anon has no session at all
insert into realtime.subscription (subscription_id, entity, filters, claims, action_filter) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'public.readings',
     array[('device_id','eq','ws-rt0000000001',false)::realtime.user_defined_filter], '{"sub":"user_a","role":"authenticated"}', 'INSERT'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'public.readings',
     array[('device_id','eq','ws-rt0000000001',false)::realtime.user_defined_filter], '{"sub":"user_b","role":"authenticated"}', 'INSERT'),
  ('cccccccc-0000-0000-0000-000000000003', 'public.readings', '{}', '{"role":"anon"}', 'INSERT');

create temp table walrus_out on commit drop as
select * from realtime.apply_rls(jsonb_build_object(
  'action','I','schema','public','table','readings',
  'columns', jsonb_build_array(
    jsonb_build_object('name','id','type','bigint','value',(select max(id) from public.readings)),
    jsonb_build_object('name','device_id','type','text','value','ws-rt0000000001'),
    jsonb_build_object('name','timestamp','type','timestamp with time zone','value','2026-08-16T00:00:00+00'),
    jsonb_build_object('name','temperature','type','numeric','value',20),
    jsonb_build_object('name','humidity','type','numeric','value',50),
    jsonb_build_object('name','pressure','type','numeric','value',1013),
    jsonb_build_object('name','wind_speed','type','numeric','value',null),
    jsonb_build_object('name','wind_direction','type','numeric','value',null),
    jsonb_build_object('name','precipitation','type','numeric','value',null)),
  'pk', jsonb_build_array(jsonb_build_object('name','id','type','bigint'))));

select ok(
  exists (select 1 from walrus_out where 'aaaaaaaa-0000-0000-0000-000000000001' = any(subscription_ids) and errors = '{}'),
  'device member A receives the readings INSERT'
);
select ok(
  not exists (select 1 from walrus_out where 'bbbbbbbb-0000-0000-0000-000000000002' = any(subscription_ids)),
  'non-member B filtering on A''s device receives nothing (RLS applied to Realtime)'
);
select ok(
  exists (select 1 from walrus_out where 'cccccccc-0000-0000-0000-000000000003' = any(subscription_ids)
    and 'Error 401: Unauthorized' = any(errors)),
  'anon subscriber gets 401, no record'
);

select * from finish();
rollback;
