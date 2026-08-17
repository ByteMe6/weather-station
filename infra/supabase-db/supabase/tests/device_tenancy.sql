begin;
select plan(6);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'user_seller'),
  ('00000000-0000-0000-0000-0000000000c2', 'user_buyer'),
  ('00000000-0000-0000-0000-0000000000c3', 'user_friend');
insert into public.devices (device_id, secret, status, label, address, latitude, longitude)
  values ('ws-tenancy00001', 's', 'registered', 'Seller home', '12 Private St', 49.5, 24.5);
insert into public.device_users (device_id, user_id, role)
  values ('ws-tenancy00001', '00000000-0000-0000-0000-0000000000c1', 'owner');

-- A device returning to the pool must not carry its tenant's data forward:
-- the next person to claim the hardware is often a buyer or an RMA recipient.
delete from public.device_users where device_id = 'ws-tenancy00001';
select is((select label from public.devices where device_id = 'ws-tenancy00001'), null, 'nickname is purged when the last member leaves');
select is((select address from public.devices where device_id = 'ws-tenancy00001'), null, 'address is purged');
select is((select latitude from public.devices where device_id = 'ws-tenancy00001'), null, 'coordinates are purged');
select is((select status from public.devices where device_id = 'ws-tenancy00001'), 'unregistered', 'and the device is claimable again');

-- A device with members always has an owner. Demoting the last one is refused…
insert into public.device_users (device_id, user_id, role) values
  ('ws-tenancy00001', '00000000-0000-0000-0000-0000000000c2', 'owner'),
  ('ws-tenancy00001', '00000000-0000-0000-0000-0000000000c3', 'viewer');
select throws_ok(
  $$ update public.device_users set role = 'viewer' where device_id = 'ws-tenancy00001' and role = 'owner' $$,
  'P0001', 'DEVICE_NEEDS_OWNER', 'the last owner cannot be demoted, even concurrently'
);

-- …while deleting the owner's membership promotes the survivor, so an account
-- deletion cascade can never fail or strand a shared device.
delete from public.device_users
 where device_id = 'ws-tenancy00001' and user_id = '00000000-0000-0000-0000-0000000000c2';
select is(
  (select role from public.device_users where device_id = 'ws-tenancy00001' and user_id = '00000000-0000-0000-0000-0000000000c3'),
  'owner', 'the remaining member inherits ownership when the owner is deleted'
);

select * from finish();
rollback;
