-- A database-side authority check for station-profile writes.
--
-- What this is NOT: parity with device_users_owner_guard. That is an
-- `after ... for each row` trigger, so it fires for every writer, including
-- shareDeviceAction's direct .from('device_users').insert(). This is a function
-- a caller has to choose to call, and init_schema:232 grants service_role
-- `all on all tables`, so a future action writing
-- `.from('devices').update({ label })` bypasses it entirely — and that is the
-- same caller this was meant to catch.
--
-- A `before update` trigger would close that, but it cannot do this job: a
-- trigger enforcing an authority needs to know who is writing, and on the
-- service-role path nobody is. There is no JWT (current_user is `service_role`,
-- request.jwt.claims is unset), so the acting user reaches SQL only as an
-- argument someone passes — which a caller that skipped the function would
-- equally skip. device_users_owner_guard has no such problem because it
-- enforces an invariant ("a device keeps an owner"), not an authorisation.
--
-- So the honest claim is narrower: this makes the *intended* write path check
-- the role in the database as well as in TypeScript, and it is the strongest
-- available on a path that carries no identity into SQL. Routing every profile
-- write through it is a convention, enforced by review and by the fact that
-- updateDeviceProfileAction is its only caller.
--
-- The role list is a second, coarser copy of canEditDeviceProfile in
-- @ws/shared. supabase/tests/device_profile.sql catches SQL-side drift, and
-- apps/web/tests/unit/lib/sqlRolePredicateParity.test.ts reads this file and
-- fails if the two lists disagree in either direction.
create or replace function public.update_device_profile(
  p_device_id text,
  p_user_id uuid,
  -- These four REPLACE the stored values; there is no partial update. An
  -- omitted argument is not "leave it alone" — it lands on the default below
  -- and clears the column, so `update_device_profile('ws-1', uuid, 'New name')`
  -- wipes the address and both coordinates. The defaults exist only because
  -- `supabase gen types` cannot express a nullable argument and would otherwise
  -- emit non-nullable Args, which the action (which must be able to clear a
  -- nickname) could not typecheck. device_profile.sql pins this behaviour so it
  -- is discovered by reading a test rather than by losing a user's address.
  p_label text default null,
  p_address text default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
-- out_-prefixed so they do not shadow the devices columns this function writes.
-- Unprefixed OUT names are correct only while every reference stays qualified;
-- adding something like `and label is distinct from p_label` later raises
-- `column reference "label" is ambiguous` at execution time, not at
-- CREATE FUNCTION time — the migration applies clean and the first save fails.
returns table (
  out_label text,
  out_address text,
  out_latitude numeric,
  out_longitude numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- `for share` for the same reason claim_device takes `for no key update`:
  -- the read and the write below are two statements under READ COMMITTED, so
  -- without it an owner demoting this user to viewer mid-save would commit
  -- between them and the demoted user's write would still land.
  select du.role into v_role
  from public.device_users du
  where du.device_id = p_device_id
    and du.user_id = p_user_id
  for share;

  -- Not a member, or a member without the authority. One error for both: the
  -- caller already resolved membership and must not learn from this function
  -- whether a station it cannot touch exists.
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'DEVICE_PROFILE_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- No half-coordinate check here: devices_coords_both_or_neither
  -- (20260816214131) already rejects it with 23514. A third copy of that rule
  -- would only add an error code the action does not map.
  return query
  update public.devices d
  set label = p_label,
      address = p_address,
      latitude = p_latitude,
      longitude = p_longitude
  where d.device_id = p_device_id
  returning d.label, d.address, d.latitude, d.longitude;
end;
$$;

-- Service role only. The browser reaching this would defeat the point: the
-- function trusts p_user_id, which is safe precisely because only a server
-- action that resolved it from a Clerk session can call it.
revoke execute on function public.update_device_profile(
  text, uuid, text, text, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.update_device_profile(
  text, uuid, text, text, numeric, numeric
) to service_role;
