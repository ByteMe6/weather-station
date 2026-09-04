-- A database-side authority check for station-profile writes.
--
-- Membership writes already have one: device_users_owner_guard
-- (20260817162453), which that file credits with catching a race the app-level
-- check missed. Profile writes had none. RLS cannot supply it — `authenticated`
-- holds no UPDATE grant on public.devices at all, so a policy would be dead
-- code, and the only writer is a service-role server action that bypasses RLS
-- by definition. The mechanism that does work here is the one claim_device and
-- redeem_telegram_link_code already use: put the write behind a
-- SECURITY DEFINER function that re-checks membership in SQL.
--
-- That leaves the threat this closes narrow and specific. It is NOT "a browser
-- writes directly" — that is already impossible at the grant. It is "the
-- TypeScript gate is wrong": a predicate widened on one side, or a new caller
-- that forgets requireProfileEditor. MRP-48 is itself the evidence that this
-- happens — `editor` was a role the UI offered that granted nothing for
-- months, and the predicate was live in three places with one of them missed.
--
-- The role list below is deliberately a second, coarser copy of
-- canEditDeviceProfile in @ws/shared, in the same relationship to it that
-- device_users_owner_guard has to the app's ownership checks: a backstop, not
-- the source of truth. supabase/tests/device_profile.sql fails if the two drift.
create or replace function public.update_device_profile(
  p_device_id text,
  p_user_id uuid,
  -- `default null` is not decoration: supabase gen types cannot infer that a
  -- function argument is nullable, so without it the generated Args type is
  -- `string`/`number` and the action — which must be able to clear a nickname —
  -- cannot typecheck. Defaulted arguments come out optional instead, and an
  -- omitted key lands on this default, which is the same "clear it" the caller
  -- means by null.
  p_label text default null,
  p_address text default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns table (
  label text,
  address text,
  latitude numeric,
  longitude numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select du.role into v_role
  from public.device_users du
  where du.device_id = p_device_id
    and du.user_id = p_user_id;

  -- Not a member, or a member without the authority. One error for both: the
  -- caller already resolved membership and must not learn from this function
  -- whether a station it cannot touch exists.
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'DEVICE_PROFILE_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Coordinates are stored as a pair or not at all; the app enforces this too,
  -- but a half-pair reaching here would silently produce a station the map
  -- cannot place.
  if (p_latitude is null) is distinct from (p_longitude is null) then
    raise exception 'DEVICE_PROFILE_HALF_COORDINATES' using errcode = 'P0001';
  end if;

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
