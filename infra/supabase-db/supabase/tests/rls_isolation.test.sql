-- RLS isolation: user A must never see user B's devices, readings,
-- device_users links, or schedules (PRD D5 success metric).
begin;
select plan(13);

-- fixtures, inserted as postgres (RLS bypassed)
insert into public.users (id, clerk_user_id)
values
  ('11111111-1111-1111-1111-111111111111', 'user_a'),
  ('22222222-2222-2222-2222-222222222222', 'user_b');

insert into public.devices (device_id, secret, status)
values
  ('device-a', 'secret-a', 'registered'),
  ('device-b', 'secret-b', 'registered');

insert into public.device_users (device_id, user_id, role)
values
  ('device-a', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('device-b', '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.readings (device_id, timestamp, temperature, humidity, pressure)
values
  ('device-a', now(), 20.0, 50.0, 1013.0),
  ('device-b', now(), 21.0, 55.0, 1012.0);

insert into public.schedules (user_id, time, days)
values
  ('11111111-1111-1111-1111-111111111111', '08:00', array[1, 2, 3]),
  ('22222222-2222-2222-2222-222222222222', '09:00', array[4, 5]);

select ok(
  not has_column_privilege('authenticated', 'public.devices', 'secret', 'SELECT'),
  'authenticated role has no SELECT privilege on devices.secret'
);

select ok(
  not has_table_privilege('authenticated', 'public.users', 'UPDATE'),
  'authenticated role has no UPDATE privilege on users (identity linkage is server-path only)'
);

-- act as user A
set local role authenticated;
set local request.jwt.claims to '{"sub":"user_a","role":"authenticated"}';

select is(
  (select count(*)::int from public.users),
  1,
  'user A sees only their own users row'
);

select is(
  (select device_id from public.devices limit 1),
  'device-a',
  'user A sees device-a, not device-b'
);

select is(
  (select count(*)::int from public.device_users),
  1,
  'user A sees only their own device_users row'
);

select is(
  (select count(*)::int from public.readings),
  1,
  'user A sees only readings for device-a'
);

select is(
  (select count(*)::int from public.schedules),
  1,
  'user A sees only their own schedule'
);

reset role;

-- act as user B
set local role authenticated;
set local request.jwt.claims to '{"sub":"user_b","role":"authenticated"}';

select is(
  (select device_id from public.devices limit 1),
  'device-b',
  'user B sees device-b, not device-a'
);

select is(
  (select count(*)::int from public.readings where device_id = 'device-a'),
  0,
  'user B cannot see device-a readings'
);

select is(
  (select count(*)::int from public.schedules where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'user B cannot see user A schedules'
);

reset role;

-- act as user A again: attempt cross-user writes on schedules
set local role authenticated;
set local request.jwt.claims to '{"sub":"user_a","role":"authenticated"}';

select throws_ok(
  $$insert into public.schedules (user_id, time, days) values ('22222222-2222-2222-2222-222222222222', '11:00', array[1])$$,
  'new row violates row-level security policy for table "schedules"',
  'user A cannot insert a schedule owned by user B'
);

update public.schedules set time = '23:59' where user_id = '22222222-2222-2222-2222-222222222222';

reset role;

select is(
  (select time::text from public.schedules where user_id = '22222222-2222-2222-2222-222222222222'),
  '09:00:00',
  'user A cannot update user B schedule'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"user_a","role":"authenticated"}';

delete from public.schedules where user_id = '22222222-2222-2222-2222-222222222222';

reset role;

select is(
  (select count(*)::int from public.schedules where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'user A cannot delete user B schedule'
);

select * from finish();
rollback;
