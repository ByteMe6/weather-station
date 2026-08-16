begin;
select plan(4);
insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-00000000000a', 'user_a');
insert into public.telegram_link_codes (code, user_id, expires_at) values ('ABCDEFGHJKMNPQRSTVWX', '00000000-0000-0000-0000-00000000000a', now() + interval '10 minutes');

select ok((select relrowsecurity from pg_class where oid = 'public.telegram_link_codes'::regclass), 'RLS enabled');
select ok(has_table_privilege('service_role', 'public.telegram_link_codes', 'select, insert, update, delete'), 'service_role has full access');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select throws_ok(
  $$ select count(*) from public.telegram_link_codes $$,
  '42501', null, 'client cannot even read link codes (no grant)'
);
select throws_ok(
  $$ insert into public.telegram_link_codes (code, user_id, expires_at) values ('X', '00000000-0000-0000-0000-00000000000a', now()) $$,
  '42501', null, 'client cannot insert link codes'
);
select * from finish();
rollback;
