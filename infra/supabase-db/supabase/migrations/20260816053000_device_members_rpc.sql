-- MRP-38 follow-up (RLS review): the sharing migration widened SELECT on
-- users and device_users so owners could list members. That had three costs:
--   * users "view own profile" no longer returned exactly one row, so the
--     unfiltered `select … from users … maybeSingle()` the dashboard relies on
--     failed with PGRST116 for any owner who had shared a device;
--   * `is_device_owner(device_id)` in the device_users policy is correlated on
--     the row's column, so it ran once per candidate row (SubPlan, not
--     InitPlan) for every unfiltered device_users read;
--   * owners could read members' full clerk_user_id / telegram_id through
--     the API — the UI masking was not a boundary.
-- Members are now listed through one SECURITY DEFINER RPC that checks
-- ownership itself and returns only the last four characters of each
-- identifier. Both broad policies go away; users/device_users are back to
-- "own rows only" for authenticated.

drop policy if exists "device owners can view all links for their devices" on public.device_users;
drop policy if exists "device owners can view members of their devices" on public.users;

-- Owners get every member; any other member gets just their own row; a
-- non-member gets nothing. Identifiers are pre-masked (4-char tails).
create or replace function public.device_members(p_device_id text)
returns table (
  user_id uuid,
  role text,
  added_at timestamptz,
  clerk_tail text,
  telegram_tail text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    du.user_id,
    du.role,
    du.added_at,
    right(u.clerk_user_id, 4) as clerk_tail,
    right(u.telegram_id::text, 4) as telegram_tail
  from public.device_users du
  join public.users u on u.id = du.user_id
  where du.device_id = p_device_id
    and (
      du.user_id = (select public.current_app_user_id())
      or (select public.is_device_owner(p_device_id))
    )
  order by du.added_at asc;
$$;

revoke execute on function public.device_members(text) from public, anon;
grant execute on function public.device_members(text) to authenticated, service_role;
