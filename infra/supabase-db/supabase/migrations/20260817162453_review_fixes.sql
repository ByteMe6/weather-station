-- Fixes from the 2026-08-17 review. Five independent problems, all found by
-- attacking the schema rather than reading it:
--
--   1. The admin SELECT policies on users/device_users/schedules broke the
--      admin's OWN dashboard: three user-facing queries are unfiltered and
--      relied on RLS meaning "own rows only".
--   2. A blank vault secret made every session with an empty org_id claim a
--      fleet admin.
--   3. A re-claimed device carried the previous owner's nickname, address and
--      coordinates into the next tenancy.
--   4. Concurrent role changes could leave a device with zero owners.
--   5. maintain_device_status() was the one function with PUBLIC execute.

-- ---------------------------------------------------------------------------
-- 1. Admin fleet reads move from policies to SECURITY DEFINER RPCs.
--
-- The permissive policies OR'd into `select … from users` (no filter, then
-- .maybeSingle() -> PGRST116 with 2+ users), `select … from device_users` (no
-- filter -> the whole fleet appears as "my stations") and `select … from
-- schedules` (no filter -> everyone's alerts). Same class of bug the sharing
-- work already fixed with device_members(); same fix, for the same reason.
--
-- devices and readings keep their admin policies: every app query against them
-- is filtered by device_id, so widening them cannot change an existing result.
drop policy if exists "admin org can view all users" on public.users;
drop policy if exists "admin org can view all device links" on public.device_users;
drop policy if exists "admin org can view all schedules" on public.schedules;

create or replace function public.admin_devices()
returns table (
  device_id text,
  status text,
  label text,
  created_at timestamptz,
  member_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.device_id,
    d.status,
    d.label,
    d.created_at,
    (select count(*) from public.device_users du where du.device_id = d.device_id)
  from public.devices d
  where (select public.is_admin_request())
  order by d.created_at desc;
$$;

create or replace function public.admin_users()
returns table (
  id uuid,
  clerk_user_id text,
  telegram_id bigint,
  created_at timestamptz,
  device_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.clerk_user_id,
    u.telegram_id,
    u.created_at,
    (select count(*) from public.device_users du where du.user_id = u.id)
  from public.users u
  where (select public.is_admin_request())
  order by u.created_at desc;
$$;

-- Both gate internally, so `authenticated` may call them: a non-admin gets an
-- empty set, never an error that would confirm the console exists.
revoke execute on function public.admin_devices() from public, anon;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_devices() to authenticated, service_role;
grant execute on function public.admin_users() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. A blank secret must never match a blank claim.
--
-- Before: `'' = ''` made every session whose token carries an empty org_id a
-- fleet admin. A Clerk template written as "{{org.id}}" renders exactly that
-- for a user with no active organisation, so the blast radius was every signed
-- in user at once. nullif() on both sides turns blank into NULL, and NULL
-- comparisons fall through to false.
create or replace function public.is_admin_request()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(
      (select decrypted_secret from vault.decrypted_secrets where name = 'admin_org_id'),
      ''
    ) = nullif((auth.jwt() ->> 'org_id'), ''),
    false
  );
$$;

-- The writer validates too: the CLI already checks the shape, but the function
-- is the boundary, and a NULL argument previously reported success while
-- vault.update_secret silently kept the old value.
create or replace function public.set_admin_org_id(p_org_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_org_id is null or p_org_id !~ '^org_[A-Za-z0-9]+$' then
    raise exception 'INVALID_ORG_ID' using errcode = 'P0001';
  end if;

  select id into v_id from vault.secrets where name = 'admin_org_id';
  if v_id is null then
    perform vault.create_secret(p_org_id, 'admin_org_id',
      'Clerk organization whose members are fleet admins');
  else
    perform vault.update_secret(v_id, p_org_id);
  end if;
end;
$$;

revoke execute on function public.set_admin_org_id(text) from public, anon, authenticated;
grant execute on function public.set_admin_org_id(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A device returning to the pool must not carry its tenant's data forward.
--
-- Nothing purged the profile when the last member left, so the next person to
-- claim the hardware — a buyer, an RMA recipient — read the previous owner's
-- nickname, street address and map coordinates. That fires on resale and on
-- account deletion (whose cascade is the main way a device empties).
--
-- Readings are deliberately kept: they are device-scoped weather values, not
-- personal data (docs/privacy-data-minimisation.md), and the same reasoning
-- already governs account deletion. Once the address and coordinates are gone
-- they are unlabelled numbers.
create or replace function public.maintain_device_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.device_users where device_id = old.device_id
  ) then
    update public.devices
       set status = 'unregistered',
           label = null,
           address = null,
           latitude = null,
           longitude = null
     where device_id = old.device_id;
  end if;
  return old;
end;
$$;

-- 5. …and it was the only function still carrying the default PUBLIC execute.
revoke execute on function public.maintain_device_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A device with members always has an owner.
--
-- The app checked "is this the last owner?" and then wrote, in two statements:
-- two admins demoting each other concurrently both passed the check and the
-- device ended with members but no owner — unmanageable, since only an owner
-- can share or edit it. The check now lives in the database, serialised on the
-- devices row so concurrent membership changes cannot interleave.
--
-- Removing every member is still allowed: that is a device returning to the
-- pool, which the trigger above handles.
create or replace function public.enforce_device_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device text := coalesce(new.device_id, old.device_id);
  v_members bigint;
  v_owners bigint;
begin
  -- Serialises with any other membership change for this device. Without it
  -- two transactions each see the other's owner and both commit a demotion.
  perform 1 from public.devices where device_id = v_device for no key update;

  select count(*), count(*) filter (where role = 'owner')
    into v_members, v_owners
    from public.device_users
   where device_id = v_device;

  if v_members > 0 and v_owners = 0 then
    raise exception 'DEVICE_NEEDS_OWNER' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

revoke execute on function public.enforce_device_has_owner() from public, anon, authenticated;

create trigger device_users_owner_guard
  after insert or update or delete on public.device_users
  for each row
  execute function public.enforce_device_has_owner();

-- ---------------------------------------------------------------------------
-- Housekeeping: claim_device selected `status` into a variable nothing read,
-- which looked like a dropped security check. The real gate is "no other owner
-- exists"; `found` after the locking select is what detects an unknown id.
create or replace function public.claim_device(p_device_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other_owner boolean;
begin
  if p_user_id is null then
    raise exception 'USER_REQUIRED' using errcode = 'P0001';
  end if;

  -- `for no key update`: serialises concurrent claimers without conflicting
  -- with the FOR KEY SHARE that readings' FK checks take on this row.
  perform 1
  from public.devices
  where device_id = p_device_id
  for no key update;

  if not found then
    raise exception 'DEVICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.device_users
    where device_id = p_device_id
      and role = 'owner'
      and user_id is distinct from p_user_id
  ) into v_other_owner;

  if v_other_owner then
    raise exception 'DEVICE_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  insert into public.device_users (device_id, user_id, role)
  values (p_device_id, p_user_id, 'owner')
  on conflict (device_id, user_id) do update set role = 'owner';

  update public.devices set status = 'registered'
  where device_id = p_device_id and status is distinct from 'registered';
end;
$$;

revoke execute on function public.claim_device(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_device(text, uuid) to service_role;

-- Cleanup sweeps filter on expiry; without this they seq-scan.
create index if not exists telegram_link_codes_expires_at_idx
  on public.telegram_link_codes (expires_at);
