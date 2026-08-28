-- Atomic redemption: validate + merge + consume in one transaction.
-- a* = web (Clerk) accounts, b* = telegram-only duplicates of the same human.
begin;
select plan(26);

insert into public.users (id, clerk_user_id, telegram_id) values
  ('00000000-0000-0000-0000-0000000000a1'::uuid, 'user_a1', null),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, 'user_a2', 7002),
  ('00000000-0000-0000-0000-0000000000a3'::uuid, 'user_a3', null),
  ('00000000-0000-0000-0000-0000000000a4'::uuid, 'user_a4', 7004),
  ('00000000-0000-0000-0000-0000000000b1'::uuid, null, 7001);

insert into public.devices (device_id, secret, status) values
  ('ws-rrrrrrrrrrr1', 's', 'registered');
insert into public.device_users (device_id, user_id, role) values
  ('ws-rrrrrrrrrrr1', '00000000-0000-0000-0000-0000000000b1'::uuid, 'owner');

insert into public.telegram_link_codes (code, user_id, expires_at) values
  ('AAAAAAAAAAAAAAAAAAAA', '00000000-0000-0000-0000-0000000000a1'::uuid, now() + interval '10 minutes'),
  ('BBBBBBBBBBBBBBBBBBBB', '00000000-0000-0000-0000-0000000000a1'::uuid, now() - interval '1 minute'),
  ('CCCCCCCCCCCCCCCCCCCC', '00000000-0000-0000-0000-0000000000a2'::uuid, now() + interval '10 minutes'),
  ('DDDDDDDDDDDDDDDDDDDD', '00000000-0000-0000-0000-0000000000a3'::uuid, now() + interval '10 minutes');

-- ---------------------------------------------------------------------------
-- privilege posture
select ok(not has_function_privilege('anon', 'public.redeem_telegram_link_code(text, bigint)', 'execute'), 'anon cannot execute redeem_telegram_link_code');
select ok(not has_function_privilege('authenticated', 'public.redeem_telegram_link_code(text, bigint)', 'execute'), 'authenticated cannot execute redeem_telegram_link_code');
select ok(has_function_privilege('service_role', 'public.redeem_telegram_link_code(text, bigint)', 'execute'), 'service_role can execute redeem_telegram_link_code');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.redeem_telegram_link_code(text,bigint)'::regprocedure),
  'redeem_telegram_link_code pins an empty search_path'
);
select ok((select prosecdef from pg_proc where oid = 'public.redeem_telegram_link_code(text,bigint)'::regprocedure), 'redeem_telegram_link_code is security definer');

-- ---------------------------------------------------------------------------
-- input guards
select throws_ok(
  $$ select public.redeem_telegram_link_code(null, 7001) $$,
  'P0001', 'CODE_REQUIRED', 'null code raises CODE_REQUIRED'
);
select throws_ok(
  $$ select public.redeem_telegram_link_code('AAAAAAAAAAAAAAAAAAAA', null) $$,
  'P0001', 'TELEGRAM_ID_REQUIRED', 'null telegram id raises TELEGRAM_ID_REQUIRED'
);

-- ---------------------------------------------------------------------------
-- unknown / expired codes are reported, never merged
select is(
  (select outcome from public.redeem_telegram_link_code('ZZZZZZZZZZZZZZZZZZZZ', 7009)),
  'invalid', 'an unknown code is invalid'
);
select is(
  (select outcome from public.redeem_telegram_link_code('BBBBBBBBBBBBBBBBBBBB', 7009)),
  'expired', 'an expired code is expired'
);
select ok(
  (select telegram_id is null from public.users where id = '00000000-0000-0000-0000-0000000000a1'::uuid),
  'a rejected code links nothing'
);

-- ---------------------------------------------------------------------------
-- happy path: absorbs the telegram-only row and spends the code
select is(
  (select outcome from public.redeem_telegram_link_code('AAAAAAAAAAAAAAAAAAAA', 7001)),
  'linked', 'a valid code links'
);
select is(
  (select telegram_id from public.users where id = '00000000-0000-0000-0000-0000000000a1'::uuid),
  7001::bigint, 'the web account claimed the telegram id'
);
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-0000000000b1'::uuid),
  0, 'the telegram-only duplicate was absorbed'
);
select is(
  (select user_id from public.device_users where device_id = 'ws-rrrrrrrrrrr1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the station moved to the web account'
);
select ok(
  (select consumed_at is not null from public.telegram_link_codes where code = 'AAAAAAAAAAAAAAAAAAAA'),
  'a successful redemption spends the code'
);
select is(
  (select outcome from public.redeem_telegram_link_code('AAAAAAAAAAAAAAAAAAAA', 7001)),
  'invalid', 'replaying a spent code is inert'
);

-- ---------------------------------------------------------------------------
-- refusals record the reason, roll the merge back, and leave the code usable.
-- Burning the code here is what stranded users before: both refusals mean
-- "fix something and come back", so the same deep link has to keep working.
select is(
  (select outcome from public.redeem_telegram_link_code('CCCCCCCCCCCCCCCCCCCC', 7009)),
  'refused', 'linking an account that already has a telegram id is refused'
);
select is(
  (select reason from public.redeem_telegram_link_code('CCCCCCCCCCCCCCCCCCCC', 7009)),
  'ALREADY_LINKED_OTHER', 'the refusal names ALREADY_LINKED_OTHER'
);
select is(
  (select failed_reason from public.telegram_link_codes where code = 'CCCCCCCCCCCCCCCCCCCC'),
  'ALREADY_LINKED_OTHER', 'the reason is recorded for the web to show'
);
select ok(
  (select consumed_at is null from public.telegram_link_codes where code = 'CCCCCCCCCCCCCCCCCCCC'),
  'a refused code is NOT spent'
);
select is(
  (select telegram_id from public.users where id = '00000000-0000-0000-0000-0000000000a2'::uuid),
  7002::bigint, 'the refused link left the existing telegram id alone'
);

-- the user unlinks, then reuses the very same code
update public.users set telegram_id = null where id = '00000000-0000-0000-0000-0000000000a2'::uuid;
select is(
  (select outcome from public.redeem_telegram_link_code('CCCCCCCCCCCCCCCCCCCC', 7009)),
  'linked', 'the same code works once the cause is fixed'
);
select ok(
  (select failed_reason is null from public.telegram_link_codes where code = 'CCCCCCCCCCCCCCCCCCCC'),
  'a later success clears the recorded failure'
);

-- ---------------------------------------------------------------------------
-- a telegram id owned by another *web* account stays a refusal
select is(
  (select reason from public.redeem_telegram_link_code('DDDDDDDDDDDDDDDDDDDD', 7004)),
  'TELEGRAM_BELONGS_TO_ACCOUNT', 'claiming another web account''s telegram id is refused'
);
select ok(
  (select telegram_id is null from public.users where id = '00000000-0000-0000-0000-0000000000a3'::uuid),
  'the refused merge was rolled back'
);
select ok(
  (select consumed_at is null from public.telegram_link_codes where code = 'DDDDDDDDDDDDDDDDDDDD'),
  'that refusal does not spend the code either'
);

select * from finish();
rollback;
