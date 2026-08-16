-- MRP-22: atomic device claim. Locks the devices row so two accounts cannot
-- both register the same id (PRD OQ3). Called only from the registration
-- server action with the service-role client, hence service_role-only.
--
-- Semantics (one owner per device, D2b sharing-aware):
--   * unknown id                          -> DEVICE_NOT_FOUND
--   * another user already owns it        -> DEVICE_ALREADY_CLAIMED
--   * caller already owns it              -> no-op (idempotent)
--   * caller is a non-owner member and no owner exists (owner left) -> promoted to owner
--   * device_id is stored lowercase by the provisioning CLI; callers normalise.
create or replace function public.claim_device(p_device_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_other_owner boolean;
begin
  if p_user_id is null then
    raise exception 'USER_REQUIRED' using errcode = 'P0001';
  end if;

  -- `for no key update`: serialises concurrent claimers without conflicting
  -- with the FOR KEY SHARE that readings' FK checks take on this row.
  select status into v_status
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

  -- Only reached when no other owner exists: insert as owner, or promote an
  -- existing non-owner membership (the previous owner left).
  insert into public.device_users (device_id, user_id, role)
  values (p_device_id, p_user_id, 'owner')
  on conflict (device_id, user_id) do update set role = 'owner';

  update public.devices set status = 'registered'
  where device_id = p_device_id and status is distinct from 'registered';
end;
$$;

revoke execute on function public.claim_device(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_device(text, uuid) to service_role;
