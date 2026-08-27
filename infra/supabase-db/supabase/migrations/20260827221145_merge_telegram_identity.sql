-- MRP-39 (PRD OQ3): dual-auth identity resolution.
--
-- A person can arrive twice: once through Clerk on the web, once through
-- Telegram (`ensureUserId` in the bot inserts a telegram-only `users` row on
-- first contact). That leaves two rows for one human, and the web linking
-- flow used to finish with a bare
--
--   update users set telegram_id = <id> where id = <clerk row>
--
-- which hits the `users.telegram_id` unique index and fails 23505. The bot
-- reported that as "This Telegram account is already linked to another user"
-- — a dead end that could only be cleared by hand-written SQL.
--
-- Resolution: linking is the single merge path. Proving control of both sides
-- (a Clerk session plus the one-time code delivered in the Telegram chat) is
-- what authorises the merge, so it runs silently, in one transaction:
--
--   * device memberships move to the Clerk row, keeping the stronger role
--   * alert slots move, dropping ones the Clerk row already has
--   * the absorbed telegram-only row is deleted (FKs cascade the remainder)
--   * the Clerk row claims telegram_id last, once the unique index is free
--
-- The Clerk row always survives: it carries the sign-in identity and is what
-- account deletion (MRP-40) operates on.
create type public.telegram_merge_result as (
  merged boolean,
  devices_moved integer,
  schedules_moved integer
);

create or replace function public.merge_telegram_identity(
  p_user_id uuid,
  p_telegram_id bigint
)
returns public.telegram_merge_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current bigint;
  v_other uuid;
  v_other_clerk text;
  v_devices integer := 0;
  v_schedules integer := 0;
  v_result public.telegram_merge_result;
begin
  if p_user_id is null then
    raise exception 'USER_REQUIRED' using errcode = 'P0001';
  end if;
  if p_telegram_id is null then
    raise exception 'TELEGRAM_ID_REQUIRED' using errcode = 'P0001';
  end if;

  -- Lock the surviving row first, and always in this order (target, then
  -- absorbed), so two concurrent links cannot deadlock against each other.
  select telegram_id into v_current
  from public.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Idempotent: re-running the same link changes nothing.
  if v_current is not distinct from p_telegram_id then
    return (false, 0, 0)::public.telegram_merge_result;
  end if;

  -- This account already points at a different Telegram account. Unlinking is
  -- the deliberate way out; silently repointing would strip alerts from the
  -- chat that is still receiving them.
  if v_current is not null then
    raise exception 'ALREADY_LINKED_OTHER' using errcode = 'P0001';
  end if;

  select id, clerk_user_id into v_other, v_other_clerk
  from public.users
  where telegram_id = p_telegram_id
  for update;

  -- No duplicate row: the plain link the flow always assumed.
  if not found then
    update public.users set telegram_id = p_telegram_id where id = p_user_id;
    return (false, 0, 0)::public.telegram_merge_result;
  end if;

  -- The Telegram id belongs to a row that has its own Clerk identity, i.e.
  -- another human's web account. Absorbing it would hand over their stations,
  -- so this stays a refusal no matter who asks.
  if v_other_clerk is not null then
    raise exception 'TELEGRAM_BELONGS_TO_ACCOUNT' using errcode = 'P0001';
  end if;

  -- Shared device: keep whichever role is stronger. Ranked inline because the
  -- roles are a 3-value check constraint, not an enum with a natural order.
  update public.device_users t
  set role = s.role
  from public.device_users s
  where s.user_id = v_other
    and t.user_id = p_user_id
    and t.device_id = s.device_id
    and (case s.role when 'owner' then 3 when 'editor' then 2 else 1 end)
      > (case t.role when 'owner' then 3 when 'editor' then 2 else 1 end);

  -- Devices only the absorbed row had. The colliding rows are left behind and
  -- removed by the cascade on the delete below.
  with moved as (
    update public.device_users s
    set user_id = p_user_id
    where s.user_id = v_other
      and not exists (
        select 1 from public.device_users t
        where t.device_id = s.device_id and t.user_id = p_user_id
      )
    returning 1
  )
  select count(*) into v_devices from moved;

  -- Alert slots, minus any the surviving account already schedules. `days` is
  -- an array, so equality here is exact-order — the bot and the web both build
  -- it ascending, and a differently ordered duplicate merely survives as a
  -- second slot rather than being lost.
  with moved as (
    update public.schedules s
    set user_id = p_user_id
    where s.user_id = v_other
      and not exists (
        select 1 from public.schedules t
        where t.user_id = p_user_id
          and t.time = s.time
          and t.timezone = s.timezone
          and t.days = s.days
      )
    returning 1
  )
  select count(*) into v_schedules from moved;

  -- Frees the unique telegram_id, and cascades away the duplicate
  -- memberships, slots and any unused link codes the absorbed row held.
  delete from public.users where id = v_other;

  update public.users set telegram_id = p_telegram_id where id = p_user_id;

  v_result := (true, v_devices, v_schedules)::public.telegram_merge_result;
  return v_result;
end;
$$;

-- Called only by the bot's link handler with the service-role client; the
-- Telegram id there comes from the signed update, never from user text.
revoke execute on function public.merge_telegram_identity(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.merge_telegram_identity(uuid, bigint) to service_role;
