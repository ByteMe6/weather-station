-- Dispatcher tick health: the tick outcome is recorded and judged, instead of
-- being discarded the way it was when two 520s and a 403 passed unnoticed.
begin;
select plan(22);

-- Real ticks may already be recorded (a local stack with the cron job running,
-- or a developer calling invoke_alert_dispatcher() by hand). The counting
-- assertions below are exact, so start from a known-empty table — the
-- surrounding transaction rolls this back.
delete from public.alert_dispatch_ticks;

-- ---------------------------------------------------------------------------
-- privilege posture: dispatcher internals are service-role only
select ok(
  (select relrowsecurity from pg_class where oid = 'public.alert_dispatch_ticks'::regclass),
  'alert_dispatch_ticks has RLS enabled'
);
select ok(not has_table_privilege('anon', 'public.alert_dispatch_ticks', 'select'), 'anon cannot read dispatcher ticks');
select ok(not has_table_privilege('authenticated', 'public.alert_dispatch_ticks', 'select'), 'authenticated cannot read dispatcher ticks');
select ok(has_table_privilege('service_role', 'public.alert_dispatch_ticks', 'select, insert, update, delete'), 'service_role has full access to dispatcher ticks');
select ok(not has_function_privilege('anon', 'public.reconcile_alert_dispatch_ticks(timestamptz)', 'execute'), 'anon cannot execute reconcile_alert_dispatch_ticks');
select ok(not has_function_privilege('authenticated', 'public.reconcile_alert_dispatch_ticks(timestamptz)', 'execute'), 'authenticated cannot execute reconcile_alert_dispatch_ticks');
select ok(has_function_privilege('service_role', 'public.reconcile_alert_dispatch_ticks(timestamptz)', 'execute'), 'service_role can execute reconcile_alert_dispatch_ticks');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.reconcile_alert_dispatch_ticks(timestamptz)'::regprocedure),
  'reconcile_alert_dispatch_ticks pins an empty search_path'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.reconcile_alert_dispatch_ticks(timestamptz)'::regprocedure),
  'reconcile_alert_dispatch_ticks is security definer'
);

-- ---------------------------------------------------------------------------
-- the tick must not go back to pg_net's 5 s default: a loaded tick (readings +
-- one Telegram call per due slot) exceeds it, and pg_net would then record a
-- failure for a tick that actually delivered.
select ok(
  (select prosrc like '%timeout_milliseconds%' from pg_proc where oid = 'public.invoke_alert_dispatcher()'::regprocedure),
  'invoke_alert_dispatcher sets an explicit http timeout'
);
select ok(
  (select prosrc like '%reconcile_alert_dispatch_ticks%' from pg_proc where oid = 'public.invoke_alert_dispatcher()'::regprocedure),
  'invoke_alert_dispatcher judges the previous tick before firing the next'
);
select ok(
  (select prosrc like '%alert_dispatch_ticks%' from pg_proc where oid = 'public.invoke_alert_dispatcher()'::regprocedure),
  'invoke_alert_dispatcher records the request it dispatched'
);

-- ---------------------------------------------------------------------------
-- reconciliation
insert into net._http_response (id, status_code, timed_out, error_msg, created) values
  (900001, 200, false, null, now() - interval '2 minutes'),
  (900002, 520, false, null, now() - interval '2 minutes'),
  (900003, 403, false, null, now() - interval '2 minutes'),
  (900004, null, true, 'Timeout was reached', now() - interval '2 minutes');

insert into public.alert_dispatch_ticks (request_id, requested_at) values
  (900001, now() - interval '2 minutes'),
  (900002, now() - interval '2 minutes'),
  (900003, now() - interval '2 minutes'),
  (900004, now() - interval '2 minutes'),
  (900005, now()),                       -- still in flight
  (900006, now() - interval '7 hours'),  -- pg_net already purged the response
  (900007, now() - interval '8 days');   -- old enough to prune
update public.alert_dispatch_ticks set settled_at = now() - interval '8 days'
  where request_id = 900007;

select is(
  public.reconcile_alert_dispatch_ticks(),
  3,
  'a 520, a 403 and a timeout are all counted as failures'
);

select is(
  (select status_code from public.alert_dispatch_ticks where request_id = 900002),
  520, 'the 520 status is recorded on the tick'
);
select is(
  (select error_msg from public.alert_dispatch_ticks where request_id = 900004),
  'Timeout was reached', 'a timed-out tick keeps pg_net''s message'
);
select ok(
  (select timed_out from public.alert_dispatch_ticks where request_id = 900004),
  'a timed-out tick is flagged as such'
);
select ok(
  (select settled_at is not null from public.alert_dispatch_ticks where request_id = 900001),
  'a healthy tick is settled too'
);

-- the just-fired tick has no response yet; settling it would invent a failure
select ok(
  (select settled_at is null from public.alert_dispatch_ticks where request_id = 900005),
  'a tick still in flight is left alone'
);

-- pg_net drops _http_response after ~6 hours; say so rather than leaving the
-- row unsettled forever and growing the partial index without bound
select is(
  (select error_msg from public.alert_dispatch_ticks where request_id = 900006),
  'no pg_net response before retention expiry',
  'a tick pg_net will never answer is settled honestly'
);

select is(
  (select count(*)::int from public.alert_dispatch_ticks where request_id = 900007),
  0, 'settled ticks older than a week are pruned'
);

-- reconciling again must be inert, not double-count
select is(
  public.reconcile_alert_dispatch_ticks(),
  0, 'a second pass finds nothing new to report'
);

-- ---------------------------------------------------------------------------
-- Monitoring must not be able to take dispatch down with it. reconcile reads
-- net._http_response, a pg_net-owned table whose schema and grants are not
-- ours; when it ran unguarded in the tick's transaction, anything it raised
-- rolled back the dispatch too, so the function added to make a failing
-- dispatcher visible was itself able to silence alerts every minute.
create or replace function public.reconcile_alert_dispatch_ticks(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $reconcile_stub$
begin
  raise exception 'simulated pg_net breakage';
end;
$reconcile_stub$;

-- No vault secrets in the test database, so the dispatcher warns and returns
-- before net.http_post — which is exactly the reach we need: had the reconcile
-- exception escaped, it would have aborted the call before that point.
select lives_ok(
  $$ select public.invoke_alert_dispatcher() $$,
  'a throwing reconcile does not abort the dispatch tick'
);

select * from finish();
rollback;
