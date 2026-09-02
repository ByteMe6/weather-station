-- Dispatcher tick health: the tick outcome is recorded and judged, instead of
-- being discarded the way it was when two 520s and a 403 passed unnoticed.
begin;
select plan(28);

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

-- Seed the vault so the dispatcher takes its real path; without secrets it
-- returns early and the assertions below would mean something different on a
-- configured stack than on a fresh one. set_alert_cron_config() rather than
-- vault.create_secret(): vault.secrets has a unique index on (name), so the
-- raw call raises duplicate key on any stack where `yarn cron:set-secret` has
-- been run, aborting this file and every assertion above it. CI only stayed
-- green because it db-resets first.
select public.set_alert_cron_config('http://127.0.0.1:1/never-answers', 'test-cron-secret');

-- Scope every assertion to the tick this block causes. The alert-dispatcher-tick
-- cron job is scheduled unconditionally (20260823145256) and fires every minute,
-- so under READ COMMITTED an unscoped count races a row committing mid-test.
delete from public.alert_dispatch_ticks;
select public.invoke_alert_dispatcher();
create temporary table seeded_tick on commit drop as
  select request_id from public.alert_dispatch_ticks
  where reconcile_error is not null;

select is(
  (select count(*)::int from seeded_tick),
  1, 'the tick was still dispatched and recorded despite a throwing reconcile'
);

-- Surviving is not enough: moving `exception when others` to wrap the whole
-- function body passes a bare lives_ok and fails this.
select ok(
  (select reconcile_error like 'reconcile failed:%'
     from public.alert_dispatch_ticks
    where request_id = (select request_id from seeded_tick)),
  'the broken reconcile is recorded on the tick row'
);

-- error_msg stays the pg_net delivery outcome; a recovered reconcile writing
-- NULL into it must not erase the evidence above.
select is(
  (select error_msg from public.alert_dispatch_ticks
    where request_id = (select request_id from seeded_tick)),
  null, 'the reconcile failure does not masquerade as a delivery error'
);

-- OTHERS does not match query_canceled (57014), so a reconcile cancelled by a
-- statement_timeout used to propagate straight through the guard.
create or replace function public.reconcile_alert_dispatch_ticks(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $cancel_stub$
begin
  raise exception sqlstate '57014' using message = 'simulated cancellation';
end;
$cancel_stub$;

delete from public.alert_dispatch_ticks;
select lives_ok(
  $$ select public.invoke_alert_dispatcher() $$,
  'a cancelled reconcile does not abort the dispatch tick'
);
select is(
  (select count(*)::int from public.alert_dispatch_ticks
    where reconcile_error like 'reconcile cancelled:%'),
  1, 'a cancelled reconcile is recorded, and the dispatch still happened'
);

-- request_id is the primary key and net.http_post only queues inside this
-- transaction, so a stale row holding the next sequence value used to abort the
-- dispatch outright. Reachable after a pg_net reinstall or a restore.
delete from public.alert_dispatch_ticks;
insert into public.alert_dispatch_ticks (request_id, requested_at, settled_at)
values ((select last_value + 1 from net.http_request_queue_id_seq),
        now() - interval '1 day', now() - interval '1 day');
select lives_ok(
  $$ select public.invoke_alert_dispatcher() $$,
  'a request_id colliding with a stale tick does not abort the dispatch'
);
select is(
  (select count(*)::int from public.alert_dispatch_ticks where settled_at is null),
  1, 'the colliding row is taken over by the new request rather than kept stale'
);

select * from finish();
rollback;
