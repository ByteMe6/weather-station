-- Admin console: members of one Clerk organization can read the whole fleet.
--
-- The org id is NOT stored here. It lives in Vault under 'admin_org_id' (set
-- per environment with `yarn admin:set-org`), so no environment's identifier
-- is committed and a missing secret fails closed.
--
-- HARD RULE: the predicate below takes no arguments and references no row
-- column, so Postgres evaluates it once per statement (InitPlan) rather than
-- once per row. Every policy wraps it as `(select public.is_admin_request())`.
-- The pgTAP suite proves this with EXPLAIN; a helper that took the row's
-- device_id would silently become a correlated SubPlan.
create or replace function public.is_admin_request()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'admin_org_id')
      = (auth.jwt() ->> 'org_id'),
    false
  );
$$;

revoke execute on function public.is_admin_request() from public, anon;
grant execute on function public.is_admin_request() to authenticated, service_role;

-- Writing the secret needs the service role; exposing it as an RPC keeps the
-- provisioning script free of raw vault SQL.
create or replace function public.set_admin_org_id(p_org_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'admin_org_id';
  if v_id is null then
    perform vault.create_secret(p_org_id, 'admin_org_id',
      'Clerk organization whose members are fleet admins');
  else
    perform vault.update_secret(v_id, p_org_id);
  end if;
end;
$$;

revoke execute on function public.set_admin_org_id(text) from public, anon, authenticated;
grant execute on function public.set_admin_org_id(text) to service_role;

-- Lets the app read back what RLS will compare against, so the console can
-- warn when ADMIN_ORG_ID and the Vault secret have drifted apart. Service role
-- only — clients have no business reading it.
create or replace function public.admin_org_id_configured()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'admin_org_id';
$$;

revoke execute on function public.admin_org_id_configured() from public, anon, authenticated;
grant execute on function public.admin_org_id_configured() to service_role;

-- Permissive policies: they OR with the existing per-user policies, so a
-- normal user's visibility is unchanged.
create policy "admin org can view all devices"
  on public.devices for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all device links"
  on public.device_users for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all readings"
  on public.readings for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all users"
  on public.users for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all schedules"
  on public.schedules for select to authenticated
  using ((select public.is_admin_request()));

-- Deliberately NOT covered: telegram_link_codes. One-time link codes have no
-- admin use case and are the one table whose contents allow hijacking an
-- identity link.
--
-- Also deliberately absent: any grant on devices.secret. The admin bypass
-- grants row visibility only; the column-list grant from the init migration is
-- what keeps the HMAC key unreadable, and RLS cannot override it.
