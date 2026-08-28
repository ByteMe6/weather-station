-- Alert dispatcher tick health (follow-up to MRP-26).
--
-- Two defects, both found by digging through the edge gateway logs after two
-- HTTP 520s (2026-08-28 05:39:40 and 06:50:39 UTC) and one 403
-- (2026-08-27 21:39:38) went entirely unnoticed by the system itself:
--
--  1. invoke_alert_dispatcher() called net.http_post() with `perform`, throwing
--     the request id away. Nothing ever read net._http_response, so the outcome
--     of every tick was discarded. A 520 is survivable — claim_due_alert_slots
--     matches a 5-minute window, so the next tick re-claims the same slots and
--     the alert lands ≤1 minute late. A 403 is not: a drifted CRON_SECRET
--     silences every alert indefinitely, and nothing anywhere would say so.
--
--  2. net.http_post defaults to timeout_milliseconds = 5000. Ticks currently
--     take ~300-900 ms only because there are no schedules yet. A real tick
--     fetches readings and calls the Telegram API once per due slot, in
--     sequence, so 5 s is a ceiling this will start hitting under load — and
--     pg_net would then record a failure for a tick that actually delivered,
--     making the only available health signal actively misleading.
--
-- Deliberately NOT added: retry. The 5-minute claim window already re-covers a
-- missed tick on the following minute, and a retry racing that window would be
-- a second delivery, not a rescue.
create table public.alert_dispatch_ticks (
  request_id bigint primary key,
  requested_at timestamptz not null default now(),
  status_code integer,
  timed_out boolean,
  error_msg text,
  settled_at timestamptz
);

comment on table public.alert_dispatch_ticks is
  'One row per pg_cron dispatcher tick, reconciled against net._http_response '
  'on the following tick. Outlives pg_net''s own 6-hour retention so dispatcher '
  'health stays queryable (MRP-28 alert timeliness).';

-- Partial index: the reconcile pass only ever scans unsettled rows.
create index alert_dispatch_ticks_unsettled_idx
  on public.alert_dispatch_ticks (requested_at)
  where settled_at is null;

-- Server-side only, like telegram_link_codes: no client has any business
-- reading dispatcher internals, so there are no policies to write.
alter table public.alert_dispatch_ticks enable row level security;
revoke all on public.alert_dispatch_ticks from anon, authenticated;
grant select, insert, update, delete on public.alert_dispatch_ticks to service_role;

-- ---------------------------------------------------------------------------
-- Reconcile the previous tick(s) against pg_net's response table.
--
-- p_now is parameterised so pgTAP can pin instants without sleeping; the
-- dispatcher calls it with no argument.
create or replace function public.reconcile_alert_dispatch_ticks(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed integer := 0;
begin
  -- Settle everything pg_net has answered. The 5-second grace keeps the tick
  -- that was just fired out of this pass — its response does not exist yet.
  with settled as (
    update public.alert_dispatch_ticks t
    set status_code = r.status_code,
        timed_out = r.timed_out,
        error_msg = r.error_msg,
        settled_at = p_now
    from net._http_response r
    where r.id = t.request_id
      and t.settled_at is null
      and t.requested_at < p_now - interval '5 seconds'
    returning t.status_code
  )
  select count(*)::integer into v_failed
  from settled
  where status_code is null or status_code < 200 or status_code >= 300;

  -- pg_net prunes _http_response after ~6 hours. Anything still unsettled by
  -- then will never be answered; recording that is honest, and stops the
  -- partial index growing without bound.
  update public.alert_dispatch_ticks
  set settled_at = p_now,
      error_msg = 'no pg_net response before retention expiry'
  where settled_at is null
    and requested_at < p_now - interval '6 hours';

  if v_failed > 0 then
    -- Visible in the postgres logs, which is where an operator looks when
    -- alerts stop arriving. The row itself carries the detail.
    raise warning 'alert dispatcher: % tick(s) did not return 2xx', v_failed;
  end if;

  -- A week is enough to answer "was the dispatcher healthy overnight?" without
  -- turning this into a table anyone has to think about.
  delete from public.alert_dispatch_ticks
  where settled_at is not null
    and requested_at < p_now - interval '7 days';

  return v_failed;
end;
$$;

revoke execute on function public.reconcile_alert_dispatch_ticks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_alert_dispatch_ticks(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- The cron tick, now recording what it dispatched.
create or replace function public.invoke_alert_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  -- Judge the previous tick before firing the next one, so a failing
  -- dispatcher reports itself every minute rather than never.
  perform public.reconcile_alert_dispatch_ticks();

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'alert_dispatcher_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'alert_cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'alert dispatcher unconfigured — run: yarn cron:set-secret <url> <secret>';
    return;
  end if;

  -- 20 s: comfortably above a loaded tick, comfortably below the 60 s cron
  -- period, so a hung request can never overlap the next one.
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'x-cron-secret', v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) into v_request_id;

  insert into public.alert_dispatch_ticks (request_id)
  values (v_request_id);
end;
$$;

revoke execute on function public.invoke_alert_dispatcher() from public, anon, authenticated;
grant execute on function public.invoke_alert_dispatcher() to service_role;
