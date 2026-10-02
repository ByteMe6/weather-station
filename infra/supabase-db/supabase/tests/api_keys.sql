-- Public station API keys + rate limiter (spec 2026-10-01). Service-role only:
-- clients hold no privilege on the tables or the functions.
begin;
select plan(40);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_api_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'user_api_b');
insert into public.api_keys (id, user_id, name, key_hash, key_hint, scope, expires_at, revoked_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'live',
   encode(sha256('key-live'::bytea), 'hex'), 'live', 'read', null, null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'revoked',
   encode(sha256('key-revoked'::bytea), 'hex'), 'revk', 'read_write', null, now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'expired',
   encode(sha256('key-expired'::bytea), 'hex'), 'expd', 'read', now() - interval '1 second', null),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', 'future',
   encode(sha256('key-b'::bytea), 'hex'), 'kb00', 'read_write', now() + interval '1 day', null);

-- Grants and RLS -------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.api_keys'::regclass), 'api_keys: RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.api_rate_limits'::regclass), 'api_rate_limits: RLS enabled');
-- Negative over the full privilege list: catches the default-ACL auto-grant of
-- RLS-exempt TRUNCATE/REFERENCES/TRIGGER to client roles.
select ok(not (
     has_table_privilege('anon', 'public.api_keys', 'select, insert, update, delete, truncate, references, trigger, maintain')
  or has_table_privilege('authenticated', 'public.api_keys', 'select, insert, update, delete, truncate, references, trigger, maintain')
), 'api_keys: anon/authenticated hold no privilege of any kind');
select ok(not (
     has_any_column_privilege('anon', 'public.api_keys', 'select, insert, update, references')
  or has_any_column_privilege('authenticated', 'public.api_keys', 'select, insert, update, references')
), 'api_keys: anon/authenticated hold no column privilege');
select ok(not (
     has_table_privilege('anon', 'public.api_rate_limits', 'select, insert, update, delete, truncate, references, trigger, maintain')
  or has_table_privilege('authenticated', 'public.api_rate_limits', 'select, insert, update, delete, truncate, references, trigger, maintain')
), 'api_rate_limits: anon/authenticated hold no privilege of any kind');
select ok(not (
     has_any_column_privilege('anon', 'public.api_rate_limits', 'select, insert, update, references')
  or has_any_column_privilege('authenticated', 'public.api_rate_limits', 'select, insert, update, references')
), 'api_rate_limits: anon/authenticated hold no column privilege');
-- bool_and per privilege: has_table_privilege('a, b') is true when ANY is held.
select ok((select bool_and(has_table_privilege('service_role', t, p))
           from unnest(array['public.api_keys', 'public.api_rate_limits']) as t,
                unnest(array['select', 'insert', 'update', 'delete']) as p),
          'service_role has CRUD on both tables');
select ok(not (
     has_function_privilege('anon', 'public.api_key_authenticate(text)', 'execute')
  or has_function_privilege('authenticated', 'public.api_key_authenticate(text)', 'execute')
), 'clients cannot execute api_key_authenticate');
select ok(not (
     has_function_privilege('anon', 'public.api_rate_limit_hit(text, integer, integer)', 'execute')
  or has_function_privilege('authenticated', 'public.api_rate_limit_hit(text, integer, integer)', 'execute')
), 'clients cannot execute api_rate_limit_hit');
select ok(
  has_function_privilege('service_role', 'public.api_key_authenticate(text)', 'execute')
  and has_function_privilege('service_role', 'public.api_rate_limit_hit(text, integer, integer)', 'execute'),
  'service_role executes both functions'
);

-- Happy path as the role that actually calls these (service_role) -------------
set local role service_role;
select isnt_empty($$ select * from public.api_key_authenticate(encode(sha256('key-b'::bytea), 'hex')) $$,
  'service_role can authenticate a key');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:sr', 3, 60) $$,
  $$ values (true, 2) $$, 'service_role can hit the rate limiter');
reset role;

-- api_key_authenticate -------------------------------------------------------
select results_eq(
  $$ select out_key_id, out_user_id, out_scope
       from public.api_key_authenticate(encode(sha256('key-live'::bytea), 'hex')) $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid,
             '00000000-0000-0000-0000-0000000000a1'::uuid, 'read'::text) $$,
  'a live key authenticates to its owner and scope'
);
select is_empty($$ select * from public.api_key_authenticate(encode(sha256('key-revoked'::bytea), 'hex')) $$,
  'a revoked key does not authenticate');
select is_empty($$ select * from public.api_key_authenticate(encode(sha256('key-expired'::bytea), 'hex')) $$,
  'an expired key does not authenticate');
select is_empty($$ select * from public.api_key_authenticate(encode(sha256('never-issued'::bytea), 'hex')) $$,
  'an unknown key does not authenticate');
select results_eq(
  $$ select out_key_id, out_user_id, out_scope
       from public.api_key_authenticate(encode(sha256('key-b'::bytea), 'hex')) $$,
  $$ values ('10000000-0000-0000-0000-000000000004'::uuid,
             '00000000-0000-0000-0000-0000000000b1'::uuid, 'read_write'::text) $$,
  'a key that expires in the future authenticates, as its own owner'
);
select isnt((select last_used_at from public.api_keys where id = '10000000-0000-0000-0000-000000000001'),
  null, 'authenticating stamps last_used_at');

-- now() is fixed for the transaction, so exact timestamps are comparable.
update public.api_keys set last_used_at = now() - interval '30 seconds'
 where id = '10000000-0000-0000-0000-000000000001';
select isnt_empty($$ select * from public.api_key_authenticate(encode(sha256('key-live'::bytea), 'hex')) $$,
  'the live key authenticates again');
select is((select last_used_at from public.api_keys where id = '10000000-0000-0000-0000-000000000001'),
  now() - interval '30 seconds', 'last_used_at is not rewritten within a minute');
update public.api_keys set last_used_at = now() - interval '2 minutes'
 where id = '10000000-0000-0000-0000-000000000001';
select isnt_empty($$ select * from public.api_key_authenticate(encode(sha256('key-live'::bytea), 'hex')) $$,
  'and once more after two minutes');
select is((select last_used_at from public.api_keys where id = '10000000-0000-0000-0000-000000000001'),
  now(), 'last_used_at is refreshed after a minute');

-- api_rate_limit_hit ---------------------------------------------------------
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 2) $$, 'first hit is allowed, two left');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 1) $$, 'second hit is allowed, one left');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 0) $$, 'third hit is allowed, none left');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (false, 0) $$, 'the hit over the limit is refused');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:u', 3, 60) $$,
  $$ values (true, 2) $$, 'buckets are independent');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (false, 0) $$, 'a refused hit is still answered refused');
select is((select count from public.api_rate_limits where bucket = 'key:t'), 5, 'a refused hit still counts');
update public.api_rate_limits set window_start = window_start - interval '60 seconds' where bucket = 'key:t';
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 2) $$, 'a new window starts the count over');
select is(
  (select out_reset_at from public.api_rate_limit_hit('key:v', 3, 60)),
  to_timestamp(floor(extract(epoch from now()) / 60) * 60) + interval '60 seconds',
  'reset_at is the end of the current window'
);
select throws_ok($$ select * from public.api_rate_limit_hit('key:t', 0, 60) $$,
  '22023', 'API_RATE_LIMIT_INVALID', 'a non-positive limit is rejected');
select throws_ok($$ select * from public.api_rate_limit_hit('key:t', 3, 0) $$,
  '22023', 'API_RATE_LIMIT_INVALID', 'a non-positive window is rejected');
select throws_ok($$ select * from public.api_rate_limit_hit('key:t', null, 60) $$,
  '22023', 'API_RATE_LIMIT_INVALID', 'a NULL limit is rejected, not failed open');

-- A late hit from the previous window must not move the window backwards.
insert into public.api_rate_limits (bucket, window_start, count)
values ('key:w', to_timestamp(floor(extract(epoch from now()) / 60) * 60) + interval '60 seconds', 1);
select isnt_empty($$ select * from public.api_rate_limit_hit('key:w', 3, 60) $$, 'a hit against a future-dated window answers');
select is((select window_start from public.api_rate_limits where bucket = 'key:w'),
  to_timestamp(floor(extract(epoch from now()) / 60) * 60) + interval '60 seconds',
  'the stored window never moves backwards');

-- Constraints ----------------------------------------------------------------
select throws_ok(
  $$ insert into public.api_keys (user_id, name, key_hash, key_hint, scope)
     values ('00000000-0000-0000-0000-0000000000a1', 'bad', 'not-a-hash', 'abcd', 'read') $$,
  '23514', null, 'key_hash must be 64 lowercase hex characters');
select throws_ok(
  $$ insert into public.api_keys (user_id, name, key_hash, key_hint, scope)
     values ('00000000-0000-0000-0000-0000000000a1', 'bad', repeat('a', 64), 'abcd', 'admin') $$,
  '23514', null, 'scope is read or read_write only');

-- Client role, for real -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_api_a","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.api_keys $$, '42501', null,
  'an authenticated client cannot read api_keys, not even its own rows');
reset role;

-- Cascade --------------------------------------------------------------------
delete from public.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.api_keys where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'deleting a user deletes their keys');

select * from finish();
rollback;
