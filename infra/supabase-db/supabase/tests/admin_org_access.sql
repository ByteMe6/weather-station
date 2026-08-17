begin;
select plan(23);

-- The suite must not depend on the developer's real Vault value.
select public.set_admin_org_id('org_pgtap_admin');

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'user_plain');
insert into public.devices (device_id, secret, status) values
  ('ws-admin0000001', 'topsecret', 'registered'),
  ('ws-other0000002', 'topsecret', 'registered');
insert into public.device_users (device_id, user_id, role) values
  ('ws-other0000002', '00000000-0000-0000-0000-0000000000a2', 'owner');
insert into public.readings (device_id, timestamp, temperature, humidity, pressure) values
  ('ws-admin0000001', '2026-08-01T00:00:00Z', 20, 50, 1000),
  ('ws-other0000002', '2026-08-01T00:00:00Z', 21, 51, 1001);
insert into public.schedules (user_id, time, timezone, days)
  values ('00000000-0000-0000-0000-0000000000a2', '07:30', 'UTC', array[1]);

-- helper properties
select ok((select prosecdef from pg_proc where oid = 'public.is_admin_request()'::regprocedure), 'is_admin_request is SECURITY DEFINER');
select is((select provolatile from pg_proc where oid = 'public.is_admin_request()'::regprocedure), 's', 'is_admin_request is STABLE');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.is_admin_request()'::regprocedure), 'is_admin_request pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.is_admin_request()', 'execute'), 'anon cannot execute is_admin_request');
select ok(not has_function_privilege('authenticated', 'public.set_admin_org_id(text)', 'execute'), 'clients cannot write the admin org id');
-- A blank secret used to match a blank org_id claim, making every session with
-- an empty claim a fleet admin.
select throws_ok(
  $$ select public.set_admin_org_id('') $$,
  'P0001', 'INVALID_ORG_ID', 'a blank admin org id is rejected at the boundary'
);
select throws_ok(
  $$ select public.set_admin_org_id(null) $$,
  'P0001', 'INVALID_ORG_ID', 'a null admin org id is rejected rather than silently kept'
);

set local role authenticated;

-- a normal user is unaffected: own rows only
select set_config('request.jwt.claims', '{"sub":"user_plain","role":"authenticated"}', true);
select is((select count(*) from public.devices), 1::bigint, 'non-admin still sees only their own device');
select is((select count(*) from public.users), 1::bigint, 'non-admin still sees only their own users row');
select ok((select public.is_admin_request()) = false, 'no org_id claim is not admin');

-- a session whose org_id is some other organisation is not admin
select set_config('request.jwt.claims', '{"sub":"user_plain","role":"authenticated","org_id":"org_someone_else"}', true);
select ok((select public.is_admin_request()) = false, 'a different org_id is not admin');

-- the admin org sees everything covered, and nothing that is not
select set_config('request.jwt.claims', '{"sub":"user_admin","role":"authenticated","org_id":"org_pgtap_admin"}', true);
select ok((select public.is_admin_request()), 'matching org_id is admin');
-- Scoped to the fixture rows, not the whole table: this suite runs against a
-- live local database that may already hold seeded devices and readings, and
-- an absolute count only ever passed on an empty one. What matters is that the
-- admin sees a device it is NOT a member of (ws-admin0000001) alongside one it
-- has no link to either — visibility no ordinary user would have.
select is(
  (select count(*) from public.devices where device_id in ('ws-admin0000001', 'ws-other0000002')),
  2::bigint, 'admin sees devices it has no membership in'
);
select is(
  (select count(*) from public.readings where device_id in ('ws-admin0000001', 'ws-other0000002')),
  2::bigint, 'admin sees readings of devices it has no membership in'
);
select throws_ok(
  $$ select count(*) from public.telegram_link_codes $$,
  '42501', null, 'admin still cannot read telegram_link_codes'
);
select ok(not has_column_privilege('authenticated', 'public.devices', 'secret', 'select'), 'devices.secret is still ungranted');

-- --- regressions from the 2026-08-17 review ---------------------------------

-- The admin bypass must not widen the three tables whose user-facing queries
-- are unfiltered: that broke the admin's OWN dashboard.
select ok(
  not exists (select 1 from public.users where clerk_user_id <> 'user_admin'),
  'admin does not see other users rows (fleet view is admin_users())'
);
select is(
  (select count(*) from public.device_users),
  0::bigint, 'admin does not see other device links (fleet view is admin_devices())'
);
select is(
  (select count(*) from public.schedules),
  0::bigint, 'admin does not see other schedules'
);

-- …while the fleet RPCs do show everything, and only to an admin.
-- Named fixtures, not a prefix: this suite runs against a live local database
-- that holds seeded stations, and `like 'ws-%'` matches those too.
select is(
  (select count(*) from public.admin_devices()
    where device_id in ('ws-admin0000001', 'ws-other0000002')),
  2::bigint, 'admin_devices() returns devices the admin is not a member of'
);
select ok(
  (select count(*) from public.admin_users()) >= 2,
  'admin_users() returns every account'
);

select set_config('request.jwt.claims', '{"sub":"user_plain","role":"authenticated"}', true);
select is(
  (select count(*) from public.admin_devices()),
  0::bigint, 'a non-admin gets nothing from admin_devices()'
);

-- Admin visibility is read-only: the policies are SELECT-only and there are no
-- client grants behind them. Adding a `for all` policy later must fail here.
select set_config('request.jwt.claims', '{"sub":"user_admin","role":"authenticated","org_id":"org_pgtap_admin"}', true);
select throws_ok(
  $$ update public.devices set label = 'seized' where device_id = 'ws-other0000002' $$,
  '42501', null, 'an admin session cannot write through the bypass'
);

select * from finish();
rollback;
