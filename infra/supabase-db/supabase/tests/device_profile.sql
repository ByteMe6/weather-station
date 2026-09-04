begin;
select plan(14);

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

-- The `set local role authenticated` above is still in force; these assertions
-- are about the service-role path, so hand the role back first.
reset role;

-- ---------------------------------------------------------------------------
-- update_device_profile(): the database-side authority check (MRP-48).
--
-- This is the backstop for the one authority that has no RLS policy to test —
-- `authenticated` holds no UPDATE grant on devices at all, so the client path
-- is closed at the grant and the only writer is a service-role server action.
-- The role list here is a deliberate second copy of canEditDeviceProfile in
-- @ws/shared; these assertions are what fail if the two ever drift.
insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000b', 'user_b'),
  ('00000000-0000-0000-0000-00000000000c', 'user_c');
insert into public.device_users (device_id, user_id, role) values
  ('ws-profile00001', '00000000-0000-0000-0000-00000000000b', 'editor'),
  ('ws-profile00001', '00000000-0000-0000-0000-00000000000c', 'viewer');
insert into public.devices (device_id, secret, status, label)
  values ('ws-profile00002', 'othersecret', 'registered', 'Untouched');

select is(
  (select label from public.update_device_profile(
     'ws-profile00001', '00000000-0000-0000-0000-00000000000a', 'By owner', null, null, null)),
  'By owner', 'an owner may write the station profile'
);
select is(
  (select label from public.update_device_profile(
     'ws-profile00001', '00000000-0000-0000-0000-00000000000b', 'By editor', null, null, null)),
  'By editor', 'an editor may write the station profile'
);
select throws_ok(
  $$ select public.update_device_profile('ws-profile00001', '00000000-0000-0000-0000-00000000000c', 'By viewer', null, null, null) $$,
  'P0001', 'DEVICE_PROFILE_FORBIDDEN', 'a viewer may not'
);
select throws_ok(
  $$ select public.update_device_profile('ws-profile00001', '00000000-0000-0000-0000-0000000000ff', 'By nobody', null, null, null) $$,
  'P0001', 'DEVICE_PROFILE_FORBIDDEN', 'a non-member may not, and is not told the station exists'
);
select throws_ok(
  $$ select public.update_device_profile('ws-profile00001', '00000000-0000-0000-0000-00000000000a', 'x', null, 49.8397, null) $$,
  'P0001', 'DEVICE_PROFILE_HALF_COORDINATES', 'half a coordinate pair is refused'
);
select is(
  (select label from public.devices where device_id = 'ws-profile00002'),
  'Untouched', 'the write is scoped to the named station'
);
-- The function trusts p_user_id, which is only safe while no client can call it.
select ok(
  not has_function_privilege('authenticated',
    'public.update_device_profile(text, uuid, text, text, numeric, numeric)', 'execute'),
  'authenticated cannot call update_device_profile directly'
);

select * from finish();
rollback;
