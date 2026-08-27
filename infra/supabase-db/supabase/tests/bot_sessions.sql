begin;
select plan(6);

select ok((select relrowsecurity from pg_class where oid = 'public.bot_sessions'::regclass), 'RLS enabled');
-- bool_and over each privilege: has_table_privilege('a, b') is true when ANY
-- listed privilege is held, which is useless as a positive assertion.
select ok((select bool_and(has_table_privilege('service_role', 'public.bot_sessions', p))
           from unnest(array['select','insert','update','delete']) as p),
          'service_role has full CRUD');
-- Negative over the full privilege list: catches the default-ACL auto-grant
-- of RLS-exempt TRUNCATE/REFERENCES/TRIGGER to client roles.
select ok(not (
     has_table_privilege('anon', 'public.bot_sessions', 'select, insert, update, delete, truncate, references, trigger')
  or has_table_privilege('authenticated', 'public.bot_sessions', 'select, insert, update, delete, truncate, references, trigger')
), 'anon/authenticated hold no privilege of any kind');
select ok(not has_any_column_privilege('anon', 'public.bot_sessions', 'select'), 'anon cannot read sessions');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select throws_ok(
  $$ select count(*) from public.bot_sessions $$,
  '42501', null, 'authenticated cannot read sessions'
);
select throws_ok(
  $$ insert into public.bot_sessions (telegram_id, state, expires_at) values (1, '{}'::jsonb, now()) $$,
  '42501', null, 'authenticated cannot insert sessions'
);
select * from finish();
rollback;
