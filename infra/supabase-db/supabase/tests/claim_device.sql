begin;
select plan(16);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b'),
  ('00000000-0000-0000-0000-00000000000c', 'user_c');
-- minted-format id (provision-device.ts mints lowercase ws-<12 hex>)
insert into public.devices (device_id, secret, status) values ('ws-3f2a9b7c1d0e', 'secret', 'unregistered');

-- privileges + hardening posture
select ok(not has_function_privilege('anon', 'public.claim_device(text, uuid)', 'execute'), 'anon cannot execute claim_device');
select ok(not has_function_privilege('authenticated', 'public.claim_device(text, uuid)', 'execute'), 'authenticated cannot execute claim_device');
select ok(has_function_privilege('service_role', 'public.claim_device(text, uuid)', 'execute'), 'service_role can execute claim_device');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.claim_device(text,uuid)'::regprocedure),
  'claim_device pins an empty search_path'
);
select ok((select prosecdef from pg_proc where oid = 'public.claim_device(text,uuid)'::regprocedure), 'claim_device is security definer');

-- input guards
select throws_ok(
  $$ select public.claim_device('ws-nope00000000', '00000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'DEVICE_NOT_FOUND', 'unknown device raises DEVICE_NOT_FOUND'
);
select throws_ok(
  $$ select public.claim_device('ws-3f2a9b7c1d0e', null) $$,
  'P0001', 'USER_REQUIRED', 'null user raises USER_REQUIRED'
);

-- happy path
select lives_ok(
  $$ select public.claim_device('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000a') $$,
  'owner claims an unregistered device'
);
select ok(
  (select status from public.devices where device_id = 'ws-3f2a9b7c1d0e') = 'registered'
  and exists (select 1 from public.device_users where device_id = 'ws-3f2a9b7c1d0e' and user_id = '00000000-0000-0000-0000-00000000000a' and role = 'owner'),
  'device is registered and the user is owner'
);

-- idempotent for the same user: still exactly one link, still owner
select lives_ok(
  $$ select public.claim_device('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000a') $$,
  'same user re-claiming is a no-op'
);
select is((select count(*)::int from public.device_users where device_id = 'ws-3f2a9b7c1d0e'), 1, 're-claim adds no rows');
select is((select role from public.device_users where device_id = 'ws-3f2a9b7c1d0e' and user_id = '00000000-0000-0000-0000-00000000000a'), 'owner', 're-claim keeps role owner');

-- another account is rejected (OQ3: one device <-> one owner)
select throws_ok(
  $$ select public.claim_device('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000b') $$,
  'P0001', 'DEVICE_ALREADY_CLAIMED', 'second account cannot claim a registered device'
);

-- sharing-aware: a viewer cannot claim while an owner exists; the owner can still re-claim
insert into public.device_users (device_id, user_id, role) values ('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000b', 'viewer');
select throws_ok(
  $$ select public.claim_device('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000b') $$,
  'P0001', 'DEVICE_ALREADY_CLAIMED', 'a viewer cannot claim while an owner exists'
);
select lives_ok(
  $$ select public.claim_device('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000a') $$,
  'the owner can re-claim after sharing'
);

-- owner left: the remaining member is promoted so the device is never stranded
delete from public.device_users where device_id = 'ws-3f2a9b7c1d0e' and user_id = '00000000-0000-0000-0000-00000000000a';
select public.claim_device('ws-3f2a9b7c1d0e', '00000000-0000-0000-0000-00000000000b');
select is((select role from public.device_users where device_id = 'ws-3f2a9b7c1d0e' and user_id = '00000000-0000-0000-0000-00000000000b'), 'owner', 'sole remaining member is promoted to owner on claim');

select * from finish();
rollback;
