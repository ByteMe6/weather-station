begin;
select plan(11);

select public.set_admin_org_id('org_pgtapadmin');
insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-0000000000a1', 'user_admin');
insert into public.devices (device_id, secret, status) values
  ('ws-plan00000001', 's', 'registered'),
  ('ws-plan00000002', 's', 'registered'),
  ('ws-plan00000003', 's', 'registered');
insert into public.device_users (device_id, user_id, role)
  values ('ws-plan00000001', '00000000-0000-0000-0000-0000000000a1', 'owner');
insert into public.readings (device_id, timestamp, temperature, humidity, pressure)
  values ('ws-plan00000001', now(), 20, 50, 1000);
insert into public.schedules (user_id, time, timezone, days)
  values ('00000000-0000-0000-0000-0000000000a1', '07:30', 'UTC', array[1]);

-- EXPLAIN cannot appear in a FROM clause, so the plan is captured by a
-- temporary SECURITY INVOKER function: it runs as the same role with the same
-- JWT claims, so the policies under test are the ones planned.
create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $$
declare
  line text;
  acc text := '';
begin
  for line in execute 'explain (costs off) ' || p_sql loop
    acc := acc || line || ' ';
  end loop;
  return acc;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_admin","role":"authenticated","org_id":"org_pgtapadmin"}', true);

-- A correlated sub-plan is referenced as `(SubPlan N)`; a hashed one — the
-- member policies' `device_id in (select …)` — as `(hashed SubPlan N)`, which
-- is evaluated once and is fine. Passing a row column into is_admin_request()
-- would produce the correlated form and fail these.
--
-- Asserting the ABSENCE of `(SubPlan` is what actually guards the rule: a
-- `like '%InitPlan%'` assertion passes on the member policies' own InitPlans
-- no matter what the admin predicate does, which made the previous version of
-- this test vacuous (proven by mutating the policy and watching it still pass).
select ok(pg_temp.plan_of('select device_id from public.devices') not like '%(SubPlan%',
  'devices: no correlated (per-row) sub-plan');
select ok(pg_temp.plan_of('select id from public.readings') not like '%(SubPlan%',
  'readings: no correlated (per-row) sub-plan');
select ok(pg_temp.plan_of('select user_id from public.device_users') not like '%(SubPlan%',
  'device_users: no correlated (per-row) sub-plan');
select ok(pg_temp.plan_of('select id from public.users') not like '%(SubPlan%',
  'users: no correlated (per-row) sub-plan');
select ok(pg_temp.plan_of('select id from public.schedules') not like '%(SubPlan%',
  'schedules: no correlated (per-row) sub-plan');

-- …and the admin predicate is still hoisted where it applies.
select ok(pg_temp.plan_of('select device_id from public.devices') like '%InitPlan%',
  'devices: the admin predicate is an InitPlan');
select ok(pg_temp.plan_of('select id from public.readings') like '%InitPlan%',
  'readings: the admin predicate is an InitPlan');

-- The readings index must survive the admin policy: this is the readings-scale
-- query the dashboard runs.
select ok(
  pg_temp.plan_of($q$select id from public.readings where device_id = 'ws-plan00000001' and timestamp > now() - interval '30 days'$q$)
    like '%readings_device_id_timestamp_idx%',
  'readings still uses the (device_id, timestamp) index under the admin policy'
);

-- Admin visibility is SELECT-only: the policies grant no writes, and the
-- fleet RPCs are read-only. Adding a `for all` policy later must fail here.
-- Scoped to the fixture rows: this suite runs against a live local database
-- that may already hold seeded stations, so absolute counts only ever pass on
-- an empty one.
select is(
  (select count(*) from public.devices where device_id like 'ws-plan%'),
  3::bigint, 'admin still sees every device (policy retained)'
);
select is(
  (select count(*) from public.users where clerk_user_id = 'user_admin'),
  1::bigint, 'admin sees their own users row'
);
select ok(
  not exists (select 1 from public.users where clerk_user_id <> 'user_admin'),
  'admin sees NO other users row (the policy that broke the dashboard is gone)'
);

select * from finish();
rollback;
