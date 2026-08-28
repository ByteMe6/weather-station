-- Atomic redemption of a Telegram link code.
--
-- The bot used to do this in two round trips: claim the code
-- (update telegram_link_codes set consumed_at) and then call
-- merge_telegram_identity(). Between them the row read as "consumed but not
-- linked", and getTelegramLinkStatusAction treated that as a *terminal*
-- failure ("Linking did not finish. Start again from settings."). Any poll
-- landing in the gap — or the bot dying mid-way, or the fetch between the two
-- calls throwing — permanently marked a link that had succeeded, or could
-- still succeed, as failed. The web then stopped polling and the spent code
-- answered the next tap with "invalid or already used".
--
-- One function, therefore one transaction: validate, merge, consume. There is
-- no observable in-between state to misread.
--
-- Refusals are deliberately NOT consumed. ALREADY_LINKED_OTHER and
-- TELEGRAM_BELONGS_TO_ACCOUNT both mean "go fix something and come back", so
-- burning the code would strand the user exactly as before. The reason is
-- recorded on the row (the web shows it) while the code stays redeemable, and
-- a later success clears it.
create type public.telegram_redeem_result as (
  outcome text,
  reason text,
  merged boolean,
  devices_moved integer,
  schedules_moved integer
);

create or replace function public.redeem_telegram_link_code(
  p_code text,
  p_telegram_id bigint
)
returns public.telegram_redeem_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_expires_at timestamptz;
  v_consumed_at timestamptz;
  v_merge public.telegram_merge_result;
  v_reason text;
begin
  if p_code is null then
    raise exception 'CODE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_telegram_id is null then
    raise exception 'TELEGRAM_ID_REQUIRED' using errcode = 'P0001';
  end if;

  -- Lock the code row: two taps of the same deep link serialise here, so only
  -- one of them can reach the merge.
  select user_id, expires_at, consumed_at
    into v_user_id, v_expires_at, v_consumed_at
  from public.telegram_link_codes
  where code = p_code
  for update;

  if not found then
    return ('invalid', null, false, 0, 0)::public.telegram_redeem_result;
  end if;
  if v_consumed_at is not null then
    return ('invalid', null, false, 0, 0)::public.telegram_redeem_result;
  end if;
  if v_expires_at <= pg_catalog.now() then
    return ('expired', null, false, 0, 0)::public.telegram_redeem_result;
  end if;

  begin
    v_merge := public.merge_telegram_identity(v_user_id, p_telegram_id);
  exception
    when sqlstate 'P0001' then
      v_reason := pg_catalog.substr(sqlerrm, 1, 200);
      -- Only the two user-fixable refusals are reported and left retryable.
      -- USER_NOT_FOUND and friends are internal faults: re-raise so they
      -- surface as errors instead of being dressed up as user problems.
      if v_reason not in ('ALREADY_LINKED_OTHER', 'TELEGRAM_BELONGS_TO_ACCOUNT')
      then
        raise;
      end if;
      -- The merge's writes are rolled back to this block's savepoint; this
      -- update is part of the outer transaction and survives.
      update public.telegram_link_codes
      set failed_reason = v_reason
      where code = p_code;
      return ('refused', v_reason, false, 0, 0)::public.telegram_redeem_result;
  end;

  -- Success: the merge is done, so spending the code is now safe. Clearing
  -- failed_reason matters for the retry path — a code refused once and
  -- redeemed after the user unlinked must not keep reporting the old refusal.
  update public.telegram_link_codes
  set consumed_at = pg_catalog.now(),
      failed_reason = null
  where code = p_code;

  return (
    'linked',
    null,
    v_merge.merged,
    v_merge.devices_moved,
    v_merge.schedules_moved
  )::public.telegram_redeem_result;
end;
$$;

-- Called only by the bot's link handler with the service-role client; the
-- Telegram id there comes from the signed update, never from user text.
revoke execute on function public.redeem_telegram_link_code(text, bigint)
  from public, anon, authenticated;
grant execute on function public.redeem_telegram_link_code(text, bigint)
  to service_role;
