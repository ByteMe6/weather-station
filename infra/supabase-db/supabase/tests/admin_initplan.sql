begin;
select plan(2);

select public.set_admin_org_id('org_pgtap_admin');
insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-0000000000a1', 'user_admin');
insert into public.devices (device_id, secret, status) values
  ('ws-plan00000001', 's', 'registered'),
  ('ws-plan00000002', 's', 'registered'),
  ('ws-plan00000003', 's', 'registered');

-- EXPLAIN cannot appear in a FROM clause, so the plan is captured by a
-- temporary SECURITY INVOKER function: it runs as the same role with the same
-- JWT claims, so the policies under test are the ones planned.
create function pg_temp.devices_plan() returns text language plpgsql as $$
declare
  line text;
  acc text := '';
begin
  for line in execute 'explain (costs off) select device_id from public.devices' loop
    acc := acc || line || ' ';
  end loop;
  return acc;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_admin","role":"authenticated","org_id":"org_pgtap_admin"}', true);

-- The admin predicate must be hoisted to an InitPlan: evaluated once per
-- statement, never once per row.
select ok(pg_temp.devices_plan() like '%InitPlan%', 'the admin predicate is an InitPlan (evaluated once per statement)');

-- A correlated sub-plan is referenced as `(SubPlan N)`; the member policy's
-- `device_id in (select …)` is referenced as `(hashed SubPlan N)`, which is
-- also evaluated once and is fine. Passing a row column into is_admin_request()
-- would produce the correlated form and fail this assertion — the regression
-- the sharing migration shipped before it was caught in review.
select ok(pg_temp.devices_plan() not like '%(SubPlan%', 'no correlated (per-row) sub-plan in the devices policy set');

select * from finish();
rollback;
