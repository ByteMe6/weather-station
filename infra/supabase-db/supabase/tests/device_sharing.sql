begin;
select plan(8);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b'),
  ('00000000-0000-0000-0000-00000000000c', 'user_c');
insert into public.devices (device_id, secret, status) values ('ws-share0000001', 's', 'registered');
insert into public.device_users (device_id, user_id, role) values
  ('ws-share0000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('ws-share0000001', '00000000-0000-0000-0000-00000000000b', 'viewer');

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.is_device_owner(text)'::regprocedure),
  'is_device_owner pins an empty search_path'
);

set local role authenticated;

-- owner sees every link on the device, and the members' identifiers
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is((select count(*) from public.device_users where device_id = 'ws-share0000001'), 2::bigint, 'owner sees all members');
select is((select count(*) from public.users), 2::bigint, 'owner sees own row plus the members of devices they own');

-- viewer sees only their own link and only their own users row
select set_config('request.jwt.claims', '{"sub":"user_b","role":"authenticated"}', true);
select is((select count(*) from public.device_users where device_id = 'ws-share0000001'), 1::bigint, 'viewer sees only own link');
select is((select count(*) from public.users), 1::bigint, 'viewer sees only own users row');
select ok((select public.is_device_owner('ws-share0000001')) = false, 'viewer is not owner');

-- viewer cannot write device_users: no INSERT/DELETE policies exist for authenticated
select throws_ok(
  $$ insert into public.device_users (device_id, user_id, role) values ('ws-share0000001', '00000000-0000-0000-0000-00000000000c', 'viewer') $$,
  '42501', null, 'viewer cannot insert device_users'
);

-- outsider sees nothing
select set_config('request.jwt.claims', '{"sub":"user_c","role":"authenticated"}', true);
select is((select count(*) from public.device_users where device_id = 'ws-share0000001'), 0::bigint, 'non-member sees nothing');

select * from finish();
rollback;
