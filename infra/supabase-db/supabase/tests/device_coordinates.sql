begin;
select plan(8);

insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-00000000000a', 'user_a');
insert into public.devices (device_id, secret, status, latitude, longitude)
  values ('ws-coords000001', 'topsecret', 'registered', 49.839700, 24.029700);
insert into public.device_users (device_id, user_id, role) values ('ws-coords000001', '00000000-0000-0000-0000-00000000000a', 'owner');

select ok(has_column_privilege('authenticated', 'public.devices', 'latitude', 'select'), 'authenticated can read devices.latitude');
select ok(has_column_privilege('authenticated', 'public.devices', 'longitude', 'select'), 'authenticated can read devices.longitude');
select ok(not has_column_privilege('authenticated', 'public.devices', 'secret', 'select'), 'devices.secret is still unreadable');
select ok(not has_column_privilege('authenticated', 'public.devices', 'latitude', 'update'), 'coordinates are read-only for clients (owners write via the server action)');

select throws_ok(
  $$ update public.devices set latitude = 91 where device_id = 'ws-coords000001' $$,
  '23514', null, 'latitude above 90 is rejected'
);
select throws_ok(
  $$ update public.devices set longitude = -181 where device_id = 'ws-coords000001' $$,
  '23514', null, 'longitude below -180 is rejected'
);
select throws_ok(
  $$ update public.devices set latitude = null where device_id = 'ws-coords000001' $$,
  '23514', null, 'half a coordinate pair is rejected'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is(
  (select latitude from public.devices where device_id = 'ws-coords000001'),
  49.839700::numeric, 'member reads the latitude through RLS'
);

select * from finish();
rollback;
