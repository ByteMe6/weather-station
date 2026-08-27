-- MRP-39: dual-auth identity resolution via merge_telegram_identity().
-- a* = web (Clerk) accounts, b* = telegram-only duplicates of the same human.
begin;
select plan(26);

insert into public.users (id, clerk_user_id, telegram_id) values
  ('00000000-0000-0000-0000-0000000000a1'::uuid, 'user_a1', null),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, 'user_a2', null),
  ('00000000-0000-0000-0000-0000000000a3'::uuid, 'user_a3', 5003),
  ('00000000-0000-0000-0000-0000000000a4'::uuid, 'user_a4', null),
  ('00000000-0000-0000-0000-0000000000b1'::uuid, null, 5001),
  ('00000000-0000-0000-0000-0000000000b2'::uuid, null, 5002);

insert into public.devices (device_id, secret, status) values
  ('ws-aaaaaaaaaaa1', 's', 'registered'),
  ('ws-bbbbbbbbbbb2', 's', 'registered'),
  ('ws-ccccccccccc3', 's', 'registered');

-- ---------------------------------------------------------------------------
-- privilege posture
select ok(not has_function_privilege('anon', 'public.merge_telegram_identity(uuid, bigint)', 'execute'), 'anon cannot execute merge_telegram_identity');
select ok(not has_function_privilege('authenticated', 'public.merge_telegram_identity(uuid, bigint)', 'execute'), 'authenticated cannot execute merge_telegram_identity');
select ok(has_function_privilege('service_role', 'public.merge_telegram_identity(uuid, bigint)', 'execute'), 'service_role can execute merge_telegram_identity');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.merge_telegram_identity(uuid,bigint)'::regprocedure),
  'merge_telegram_identity pins an empty search_path'
);
select ok((select prosecdef from pg_proc where oid = 'public.merge_telegram_identity(uuid,bigint)'::regprocedure), 'merge_telegram_identity is security definer');

-- ---------------------------------------------------------------------------
-- input guards
select throws_ok(
  $$ select public.merge_telegram_identity(null, 5001) $$,
  'P0001', 'USER_REQUIRED', 'null user raises USER_REQUIRED'
);
select throws_ok(
  $$ select public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a1'::uuid, null) $$,
  'P0001', 'TELEGRAM_ID_REQUIRED', 'null telegram id raises TELEGRAM_ID_REQUIRED'
);
select throws_ok(
  $$ select public.merge_telegram_identity('00000000-0000-0000-0000-00000000dead'::uuid, 5001) $$,
  'P0001', 'USER_NOT_FOUND', 'unknown user raises USER_NOT_FOUND'
);

-- ---------------------------------------------------------------------------
-- no duplicate row exists: a plain link, nothing merged
select ok(
  (select merged from public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a2'::uuid, 7777)) = false,
  'linking an unseen telegram id reports merged = false'
);
select ok(
  (select telegram_id from public.users where id = '00000000-0000-0000-0000-0000000000a2'::uuid) = 7777,
  'the unseen telegram id is claimed by the web row'
);
select ok(
  (select merged from public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a2'::uuid, 7777)) = false,
  're-linking the same telegram id is an idempotent no-op'
);

-- the web row already points at a different telegram account
select throws_ok(
  $$ select public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a2'::uuid, 5001) $$,
  'P0001', 'ALREADY_LINKED_OTHER', 'repointing an already-linked account is refused'
);

-- the telegram id belongs to someone else's *web* account
select throws_ok(
  $$ select public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a1'::uuid, 5003) $$,
  'P0001', 'TELEGRAM_BELONGS_TO_ACCOUNT', 'a telegram id owned by another clerk account is never absorbed'
);

-- ---------------------------------------------------------------------------
-- the real merge: b1 owns a device a1 does not have, shares one where b1 has
-- the stronger role and one where a1 does, and carries one duplicate plus one
-- unique alert slot.
insert into public.device_users (device_id, user_id, role) values
  ('ws-aaaaaaaaaaa1', '00000000-0000-0000-0000-0000000000b1'::uuid, 'owner'),
  ('ws-bbbbbbbbbbb2', '00000000-0000-0000-0000-0000000000b1'::uuid, 'owner'),
  ('ws-bbbbbbbbbbb2', '00000000-0000-0000-0000-0000000000a1'::uuid, 'viewer'),
  ('ws-ccccccccccc3', '00000000-0000-0000-0000-0000000000b1'::uuid, 'viewer'),
  ('ws-ccccccccccc3', '00000000-0000-0000-0000-0000000000a1'::uuid, 'owner');

insert into public.schedules (user_id, time, timezone, days) values
  ('00000000-0000-0000-0000-0000000000b1'::uuid, '07:30', 'Europe/Kyiv', array[1,2,3,4,5]::smallint[]),
  ('00000000-0000-0000-0000-0000000000b1'::uuid, '21:00', 'Europe/Kyiv', array[6,7]::smallint[]),
  ('00000000-0000-0000-0000-0000000000a1'::uuid, '07:30', 'Europe/Kyiv', array[1,2,3,4,5]::smallint[]);

select ok(
  (select devices_moved from public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a1'::uuid, 5001)) = 1,
  'only the device the web row lacked is counted as moved'
);
select ok(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000b1'::uuid) = 0,
  'the absorbed telegram-only row is gone — no orphan duplicate'
);
select ok(
  (select telegram_id from public.users where id = '00000000-0000-0000-0000-0000000000a1'::uuid) = 5001,
  'the surviving web row now owns the telegram id'
);
select ok(
  (select count(*) from public.device_users where user_id = '00000000-0000-0000-0000-0000000000b1'::uuid) = 0,
  'no membership is left pointing at the absorbed row'
);
select ok(
  (select role from public.device_users where device_id = 'ws-aaaaaaaaaaa1' and user_id = '00000000-0000-0000-0000-0000000000a1'::uuid) = 'owner',
  'a device only the telegram row had moves across as owner'
);
select ok(
  (select role from public.device_users where device_id = 'ws-bbbbbbbbbbb2' and user_id = '00000000-0000-0000-0000-0000000000a1'::uuid) = 'owner',
  'a shared device is upgraded to the stronger role (viewer -> owner)'
);
select ok(
  (select role from public.device_users where device_id = 'ws-ccccccccccc3' and user_id = '00000000-0000-0000-0000-0000000000a1'::uuid) = 'owner',
  'a shared device keeps the stronger role it already had (owner beats viewer)'
);
select ok(
  (select count(*) from public.device_users where device_id = 'ws-bbbbbbbbbbb2') = 1,
  'the duplicate membership is cascaded away, leaving exactly one row'
);
select ok(
  (select count(*) from public.schedules where user_id = '00000000-0000-0000-0000-0000000000a1'::uuid) = 2,
  'the unique alert slot moves and the identical one is dropped'
);
select ok(
  (select count(*) from public.schedules where time = '21:00' and user_id = '00000000-0000-0000-0000-0000000000a1'::uuid) = 1,
  'the slot the web account did not have survives the merge'
);
select ok(
  (select count(*) from public.schedules where user_id = '00000000-0000-0000-0000-0000000000b1'::uuid) = 0,
  'no alert slot is left pointing at the absorbed row'
);

-- ---------------------------------------------------------------------------
-- a duplicate row carrying nothing still merges: the point is freeing the
-- telegram id, not what came with it.
select ok(
  (select merged from public.merge_telegram_identity('00000000-0000-0000-0000-0000000000a4'::uuid, 5002)) = true,
  'absorbing an empty telegram-only row still reports merged = true'
);
select ok(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000b2'::uuid) = 0
  and (select telegram_id from public.users where id = '00000000-0000-0000-0000-0000000000a4'::uuid) = 5002,
  'the empty duplicate is removed and its telegram id transferred'
);

select * from finish();
rollback;
