-- Stop the tick's own health reporting from being able to silence delivery.
--
-- 20260828202016 added `perform public.reconcile_alert_dispatch_ticks();` at
-- the top of invoke_alert_dispatcher(). Both run in the cron job's single
-- transaction, and reconcile reads net._http_response — a pg_net-owned table
-- that has moved between schemas across pg_net releases and whose grants are
-- not ours. If reading it ever raises, the exception propagates out of
-- invoke_alert_dispatcher() before the http_post, so every minute's dispatch
-- is rolled back: the function added to make a failing dispatcher visible
-- would instead be what stops alerts going out, and the ticks table would
-- record nothing to say so.
--
-- Reconcile is monitoring, dispatch is the job. Monitoring failing must never
-- take the job down with it — but it must not vanish either: reconcile owns
-- both the settle passes and the 7-day prune, so a permanently failing one
-- means ticks are never judged, the table grows a row a minute forever, and
-- the 403/520 detection this whole mechanism exists for is dead. A `warning`
-- alone leaves that in a log nobody queries, so the failure is also stamped on
-- the tick row itself, in the table an operator already reads.
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
  -- Judge the previous tick before firing the next one, so a failing
  -- dispatcher reports itself every minute rather than never. Isolated in its
  -- own block: a reconcile that throws loses this tick's bookkeeping, which is
  -- recoverable, instead of the dispatch, which is not.
  begin
    perform public.reconcile_alert_dispatch_ticks();
  exception
    when others then
      v_reconcile_error := 'reconcile failed: ' || sqlerrm;
      raise warning 'alert tick reconcile failed (dispatch continues): %', sqlerrm;
  end;

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

  -- error_msg carries the reconcile failure until the tick settles and the
  -- (recovered) reconcile overwrites it with the real HTTP outcome. While
  -- reconcile stays broken nothing settles, so the message persists — which is
  -- the point: the breakage shows up where the operator is already looking.
  insert into public.alert_dispatch_ticks (request_id, error_msg)
  values (v_request_id, v_reconcile_error);
end;
$$;

revoke execute on function public.invoke_alert_dispatcher() from public, anon, authenticated;
grant execute on function public.invoke_alert_dispatcher() to service_role;
