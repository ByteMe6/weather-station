begin;
select plan(19);

-- Fixtures: one Kyiv weekday-morning slot, one UTC slot just before midnight,
-- and a web-only user (no telegram_id) whose slot must never claim.
insert into public.users (id, telegram_id) values
  ('00000000-0000-0000-0000-0000000000a1', 1001),
  ('00000000-0000-0000-0000-0000000000a2', 1002);
insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000a3', 'web_only');
insert into public.schedules (user_id, time, timezone, days) values
  ('00000000-0000-0000-0000-0000000000a1', '07:30', 'Europe/Kyiv', array[1,2,3,4,5]::smallint[]),
  ('00000000-0000-0000-0000-0000000000a2', '23:58', 'UTC', array[1,2,3,4,5,6,7]::smallint[]),
  ('00000000-0000-0000-0000-0000000000a3', '07:30', 'UTC', array[1,2,3,4,5,6,7]::smallint[]);

-- 2026-08-24 is a Monday. 04:30 UTC = 07:30 Kyiv (UTC+3 in August).
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:30:30+00'::timestamptz)) = 1,
  'kyiv slot fires at its local minute'
);
select ok(
  (select count(*) from public.alert_deliveries where status = 'claimed') = 1,
  'claim recorded'
);
select ok(
  (select fire_date from public.alert_deliveries limit 1) = date '2026-08-24',
  'fire_date is the local date'
);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:31:00+00'::timestamptz)) = 0,
  'second tick does not double-fire (idempotency, T7)'
);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:36:00+00'::timestamptz)) = 0,
  'window closes after 5 minutes'
);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:29:59+00'::timestamptz)) = 0,
  'window does not open early'
);
-- Saturday 2026-08-29 04:30 UTC: the Mon-Fri slot must not fire.
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-29 04:30:00+00'::timestamptz)) = 0,
  'day-of-week respected'
);
-- Regression: one slot with an unrecognised (client-writable) timezone must
-- not abort the tick. a1 gets a valid 06:00 UTC slot; a4 an invalid-zone one
-- at the same time. The claim must not throw and must return only the valid.
insert into public.users (id, telegram_id) values
  ('00000000-0000-0000-0000-0000000000a4', 1004);
insert into public.schedules (user_id, time, timezone, days) values
  ('00000000-0000-0000-0000-0000000000a1', '06:00', 'UTC', array[1,2,3,4,5,6,7]::smallint[]),
  ('00000000-0000-0000-0000-0000000000a4', '06:00', 'Europe/Pwned', array[1,2,3,4,5,6,7]::smallint[]);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-27 06:00:30+00'::timestamptz)) = 1,
  'an unrecognised timezone on one slot is skipped, not fatal to the tick'
);
-- Midnight wrap: 23:58 UTC slot claimed at 00:01 next day, fire_date = previous day.
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-25 00:01:00+00'::timestamptz)) = 1,
  'catch-up window crosses midnight'
);
select ok(
  (select count(*) from public.alert_deliveries where fire_date = date '2026-08-24'
     and schedule_id = (select id from public.schedules where time = '23:58')) = 1,
  'midnight-wrap fire_date is the slot''s local date'
);
-- The web-only user (telegram_id null) never claims.
select ok(
  not exists (
    select 1 from public.claim_due_alert_slots('2026-08-24 07:30:30+00'::timestamptz) c
    where c.user_id = '00000000-0000-0000-0000-0000000000a3'
  ),
  'users without telegram_id are skipped'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.alert_deliveries'::regclass),
  'RLS enabled on alert_deliveries'
);
select ok((select bool_and(has_table_privilege('service_role', 'public.alert_deliveries', p))
           from unnest(array['select','insert','update','delete']) as p),
          'service_role has full CRUD');
select ok(not (
     has_table_privilege('anon', 'public.alert_deliveries', 'select, insert, update, delete, truncate, references, trigger')
  or has_table_privilege('authenticated', 'public.alert_deliveries', 'select, insert, update, delete, truncate, references, trigger')
), 'anon/authenticated hold no table privilege of any kind');
-- The default ACL auto-grants UPDATE on the sequence; UPDATE alone permits
-- nextval/setval, so a table-level revoke does not contain it.
select ok(not (
     has_sequence_privilege('anon', 'public.alert_deliveries_id_seq', 'usage, select, update')
  or has_sequence_privilege('authenticated', 'public.alert_deliveries_id_seq', 'usage, select, update')
), 'anon/authenticated hold no sequence privilege of any kind');
select ok(
  exists (select 1 from cron.job where jobname = 'alert-dispatcher-tick' and schedule = '* * * * *'),
  'every-minute cron job registered'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"web_only","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.claim_due_alert_slots() $$,
  '42501', null, 'clients cannot execute the claim RPC'
);
-- The vault-touching functions are the higher-value targets; prove no client
-- role can execute them.
select throws_ok(
  $$ select public.set_alert_cron_config('http://x', 's') $$,
  '42501', null, 'clients cannot execute set_alert_cron_config'
);
select throws_ok(
  $$ select public.invoke_alert_dispatcher() $$,
  '42501', null, 'clients cannot execute invoke_alert_dispatcher'
);
select * from finish();
rollback;
