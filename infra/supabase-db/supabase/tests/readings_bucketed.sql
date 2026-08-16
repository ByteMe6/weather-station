begin;
select plan(9);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b');
insert into public.devices (device_id, secret, status) values ('ws-bucket000001', 's', 'registered');
insert into public.device_users (device_id, user_id, role) values ('ws-bucket000001', '00000000-0000-0000-0000-00000000000a', 'owner');
insert into public.readings (device_id, timestamp, temperature, humidity, pressure) values
  ('ws-bucket000001', '2026-08-01T00:00:00Z', 10, 50, 1000),
  ('ws-bucket000001', '2026-08-01T00:30:00Z', 12, 52, 1001),
  ('ws-bucket000001', '2026-08-01T01:10:00Z', 20, 40, 1002);

select ok(has_function_privilege('authenticated', 'public.readings_bucketed(text, timestamptz, timestamptz, int)', 'execute'), 'authenticated can execute');
select ok(not has_function_privilege('anon', 'public.readings_bucketed(text, timestamptz, timestamptz, int)', 'execute'), 'anon cannot execute');
select ok(has_function_privilege('service_role', 'public.readings_bucketed(text, timestamptz, timestamptz, int)', 'execute'), 'service_role can execute');
select ok(not (select prosecdef from pg_proc where oid = 'public.readings_bucketed(text, timestamptz, timestamptz, int)'::regprocedure), 'readings_bucketed is SECURITY INVOKER so readings RLS applies inside');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.readings_bucketed(text, timestamptz, timestamptz, int)'::regprocedure), 'readings_bucketed pins an empty search_path');

-- as user A (member): two hourly buckets, first bucket avg 11 / min 10 / max 12
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is(
  (select count(*) from public.readings_bucketed('ws-bucket000001', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 60)),
  2::bigint, 'member gets one row per hourly bucket'
);
select is(
  (select round(avg_temperature, 1) from public.readings_bucketed('ws-bucket000001', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 60) order by bucket limit 1),
  11.0::numeric, 'first bucket averages 10 and 12'
);

-- out-of-range bucket sizes return nothing rather than erroring (callers pass constants)
select is(
  (select count(*) from public.readings_bucketed('ws-bucket000001', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 0)),
  0::bigint, 'bucket size 0 yields zero rows'
);

-- as user B (not a member): RLS makes the function see nothing
select set_config('request.jwt.claims', '{"sub":"user_b","role":"authenticated"}', true);
select is(
  (select count(*) from public.readings_bucketed('ws-bucket000001', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 60)),
  0::bigint, 'non-member gets zero rows (security invoker + RLS)'
);

select * from finish();
rollback;
