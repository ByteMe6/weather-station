begin;
select plan(19);

insert into public.users (id, clerk_user_id, telegram_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a', null),
  ('00000000-0000-0000-0000-00000000000b', 'user_b', 987654821),
  ('00000000-0000-0000-0000-00000000000c', 'user_c', null);
insert into public.devices (device_id, secret, status) values
  ('ws-share0000001', 's', 'registered'),
  ('ws-share0000002', 's', 'registered');
-- device 1: a owns, b views. device 2: c owns, b views. a and c never share a device.
insert into public.device_users (device_id, user_id, role) values
  ('ws-share0000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('ws-share0000001', '00000000-0000-0000-0000-00000000000b', 'viewer'),
  ('ws-share0000002', '00000000-0000-0000-0000-00000000000c', 'owner'),
  ('ws-share0000002', '00000000-0000-0000-0000-00000000000b', 'viewer');

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.is_device_owner(text)'::regprocedure),
  'is_device_owner pins an empty search_path'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.device_members(text)'::regprocedure),
  'device_members pins an empty search_path'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.device_members(text)'::regprocedure),
  'device_members is SECURITY DEFINER (it must see rows RLS hides from the caller)'
);
select ok(not has_function_privilege('anon', 'public.device_members(text)', 'execute'), 'anon cannot execute device_members');
select ok(has_function_privilege('authenticated', 'public.device_members(text)', 'execute'), 'authenticated can execute device_members');
-- the broad policies from the first sharing migration are gone
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'device owners can view members of their devices'),
  0::bigint, 'the owner-view policy on users was dropped'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'device_users' and policyname = 'device owners can view all links for their devices'),
  0::bigint, 'the owner-view policy on device_users was dropped'
);

set local role authenticated;

-- owner of device 1: every member, identifiers masked to 4-char tails
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is((select count(*) from public.device_members('ws-share0000001')), 2::bigint, 'owner lists all members of their device');
select is(
  (select clerk_tail from public.device_members('ws-share0000001') where user_id = '00000000-0000-0000-0000-00000000000b'),
  'er_b', 'members come back with only the tail of clerk_user_id'
);
select is(
  (select telegram_tail from public.device_members('ws-share0000001') where user_id = '00000000-0000-0000-0000-00000000000b'),
  '4821', 'members come back with only the tail of telegram_id'
);
select is((select count(*) from public.device_members('ws-share0000002')), 0::bigint, 'owner of device 1 sees nothing for device 2 (not a member)');
select is((select count(*) from public.users), 1::bigint, 'owner still reads exactly one users row (own) — maybeSingle stays valid');
select is((select count(*) from public.device_users), 1::bigint, 'owner reads only their own device_users link directly');

-- viewer b: own row only, on both devices
select set_config('request.jwt.claims', '{"sub":"user_b","role":"authenticated"}', true);
select is((select count(*) from public.device_members('ws-share0000001')), 1::bigint, 'viewer sees only their own membership');
select is((select user_id from public.device_members('ws-share0000002')), '00000000-0000-0000-0000-00000000000b'::uuid, 'viewer of device 2 sees only themselves there too');
select ok((select public.is_device_owner('ws-share0000001')) = false, 'viewer is not owner');
select throws_ok(
  $$ insert into public.device_users (device_id, user_id, role) values ('ws-share0000001', '00000000-0000-0000-0000-00000000000c', 'viewer') $$,
  '42501', null, 'viewer cannot insert device_users'
);

-- outsider c (owns device 2, no link to device 1)
select set_config('request.jwt.claims', '{"sub":"user_c","role":"authenticated"}', true);
select is((select count(*) from public.device_members('ws-share0000001')), 0::bigint, 'non-member sees nothing');
select is((select count(*) from public.device_members('ws-share0000002')), 2::bigint, 'and lists all members of the device they do own');

select * from finish();
rollback;
