begin;
select plan(14);

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
select is((select count(*) from public.devices), 2::bigint, 'admin sees every device');
select is((select count(*) from public.readings), 2::bigint, 'admin sees every reading');
select throws_ok(
  $$ select count(*) from public.telegram_link_codes $$,
  '42501', null, 'admin still cannot read telegram_link_codes'
);
select ok(not has_column_privilege('authenticated', 'public.devices', 'secret', 'select'), 'devices.secret is still ungranted');

select * from finish();
rollback;
