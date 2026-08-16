-- MRP-38: owners need to see every member of their device to manage sharing.
-- A policy on device_users that queries device_users would recurse, so the
-- owner check lives in a SECURITY DEFINER helper. STABLE and wrapped as
-- (select …) in the policy so it runs once per statement (InitPlan).
create or replace function public.is_device_owner(p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.device_users du
    where du.device_id = p_device_id
      and du.user_id = (select public.current_app_user_id())
      and du.role = 'owner'
  );
$$;

revoke execute on function public.is_device_owner(text) from public, anon;
grant execute on function public.is_device_owner(text) to authenticated, service_role;

create policy "device owners can view all links for their devices"
  on public.device_users
  for select
  to authenticated
  using ((select public.is_device_owner(device_id)));

-- Owners also need the members' identifiers (masked in the UI). users has
-- "view own profile" only; extend to rows sharing a device the caller owns.
-- Note: is_device_owner() is evaluated per candidate row here (it depends on
-- the row's device), which is fine at MVP scale (a handful of members).
create policy "device owners can view members of their devices"
  on public.users
  for select
  to authenticated
  using (
    exists (
      select 1 from public.device_users du
      where du.user_id = users.id
        and public.is_device_owner(du.device_id)
    )
  );
