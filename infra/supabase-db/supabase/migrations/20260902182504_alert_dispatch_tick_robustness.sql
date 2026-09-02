-- Three ways the tick's own bookkeeping could still abort the dispatch it was
-- added to protect, plus an honest account of where the evidence goes.
--
-- 1. `exception when others` does not match query_canceled (57014) — PL/pgSQL
--    excludes it from OTHERS. A reconcile cancelled by a statement_timeout or
--    pg_cancel_backend therefore propagated straight through the guard added in
--    20260901170301 and rolled the dispatch back, which is precisely the failure
--    that guard exists to prevent. reconcile scans net._http_response, the table
--    most likely here to run long or block, and grows with the ticks table.
--
-- 2. The bookkeeping INSERT sat outside the guard and request_id is the primary
--    key. net.http_post only queues a row in the caller's transaction, so a
--    duplicate key aborts the queued request too: nothing is sent, every minute,
--    with no row to say so. Reachable after `drop extension pg_net; create
--    extension pg_net;` (a documented pg_net remediation) or a restore, either
--    of which restarts net.http_request_queue_id_seq at 1 while this table still
--    holds rows with low ids — guaranteed if reconcile is broken, because then
--    nothing settles and nothing is pruned. `on conflict` makes the id's new
--    owner win, which is correct: it now refers to a different request.
--
-- 3. The reconcile failure was written to `error_msg`, which reconcile itself
--    overwrites with the HTTP outcome the moment it recovers (NULL for a 2xx) —
--    erasing the only evidence — and which `where error_msg is not null` then
--    cannot distinguish from ordinary delivery errors. It gets its own column.
--
-- Correcting the record on 20260901170301: its comments called this table "the
-- table an operator already reads". Nothing reads it — no view, no RPC, no
-- admin query, service_role grants only. The stamp is for whoever goes looking
-- after alerts stop; the warning is still what surfaces on its own.
alter table public.alert_dispatch_ticks
  add column if not exists reconcile_error text;

comment on column public.alert_dispatch_ticks.reconcile_error is
  'Set when reconcile_alert_dispatch_ticks() threw during this tick. Separate '
  'from error_msg so a recovered reconcile cannot erase it and so error_msg '
  'stays purely the pg_net delivery outcome.';

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
  v_reconcile_error text;
begin
  -- Judge the previous tick before firing the next one, so a failing dispatcher
  -- reports itself every minute rather than never. Isolated so a reconcile that
  -- throws loses this tick's bookkeeping, which is recoverable, instead of the
  -- dispatch, which is not. query_canceled is spelled out because OTHERS does
  -- not cover it.
  begin
    perform public.reconcile_alert_dispatch_ticks();
  exception
    when query_canceled then
      v_reconcile_error := 'reconcile cancelled: ' || sqlerrm;
      raise warning 'alert tick reconcile cancelled (dispatch continues): %', sqlerrm;
    when others then
      v_reconcile_error := 'reconcile failed: ' || sqlerrm;
      raise warning 'alert tick reconcile failed (dispatch continues): %', sqlerrm;
  end;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'alert_dispatcher_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'alert_cron_secret';
  if v_url is null or v_secret is null then
    -- No request is made, so there is no row to carry v_reconcile_error. Both
    -- facts are warnings and nothing else; do not read the absence of a row on
    -- an unconfigured stack as a healthy reconcile.
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

  insert into public.alert_dispatch_ticks (request_id, reconcile_error)
  values (v_request_id, v_reconcile_error)
  on conflict (request_id) do update
  set requested_at = pg_catalog.now(),
      reconcile_error = excluded.reconcile_error,
      status_code = null,
      timed_out = null,
      error_msg = null,
      settled_at = null;
end;
$$;

revoke execute on function public.invoke_alert_dispatcher() from public, anon, authenticated;
grant execute on function public.invoke_alert_dispatcher() to service_role;
