begin;
select plan(7);

insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-00000000000a', 'user_a');
insert into public.devices (device_id, secret, status, label, address)
  values ('ws-profile00001', 'topsecret', 'registered', 'Backyard', '1 Main St');
insert into public.device_users (device_id, user_id, role) values ('ws-profile00001', '00000000-0000-0000-0000-00000000000a', 'owner');

select ok(has_column_privilege('authenticated', 'public.devices', 'label', 'select'), 'authenticated can read devices.label');
select ok(has_column_privilege('authenticated', 'public.devices', 'address', 'select'), 'authenticated can read devices.address');
select ok(not has_column_privilege('authenticated', 'public.devices', 'secret', 'select'), 'devices.secret is still unreadable');
select ok(not has_column_privilege('authenticated', 'public.devices', 'label', 'update'), 'label is read-only for clients (owners and editors write through the server action)');
select throws_ok(
  $$ update public.devices set label = '' where device_id = 'ws-profile00001' $$,
  '23514', null, 'empty label is rejected by the check constraint'
);
select throws_ok(
  $$ update public.devices set label = repeat('x', 41) where device_id = 'ws-profile00001' $$,
  '23514', null, 'a 41-character label is rejected by the check constraint'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is((select label from public.devices where device_id = 'ws-profile00001'), 'Backyard', 'member reads the label through RLS');

select * from finish();
rollback;
