-- Alert dispatcher (PRD T6/T7, OQ4): pg_cron ticks every minute; the claim
-- RPC finds due slots and the unique (schedule_id, fire_date) is the
-- never-double-fire guard. Local-time matching uses a 5-minute catch-up
-- window checked against BOTH today's and yesterday's local date so a slot
-- near midnight still fires exactly once (spec §Data model).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.alert_deliveries (
  id bigint generated always as identity primary key,
  schedule_id bigint not null
    references public.schedules (id) on delete cascade,
  fire_date date not null,
  status text not null default 'claimed'
    check (status in ('claimed', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (schedule_id, fire_date)
);
-- The unique constraint's index leads on schedule_id, so it serves the FK;
-- no extra index needed.

alter table public.alert_deliveries enable row level security;

-- Service-role only. Revoke first: the default ACL on schema public still
-- auto-grants RLS-exempt TRUNCATE/REFERENCES/TRIGGER to client roles on
-- every new table (same hazard the init migration documents).
revoke all on public.alert_deliveries from anon, authenticated;
-- The default ACL auto-grants UPDATE on a new sequence to client roles too,
-- and UPDATE alone permits nextval/setval — a signed-in user could setval the
-- id to bigint max and break every future claim INSERT. Revoke it explicitly;
-- the table revoke above does not cover the sequence.
revoke all on sequence public.alert_deliveries_id_seq from anon, authenticated;
grant select, insert, update, delete on public.alert_deliveries to service_role;
grant usage, select on sequence public.alert_deliveries_id_seq to service_role;

-- Volatile on purpose: the claim mutates alert_deliveries. p_now is
-- parameterised so pgTAP can pin instants (DST, midnight wrap); the
-- dispatcher calls it with no argument.
create or replace function public.claim_due_alert_slots(p_now timestamptz default now())
returns table (
  schedule_id bigint,
  user_id uuid,
  telegram_id bigint,
  slot_time time,
  slot_timezone text,
  fire_date date
)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      s.id as schedule_id,
      s.user_id,
      u.telegram_id,
      s.time as slot_time,
      s.timezone as slot_timezone,
      d.candidate_date as fire_date
    from public.schedules s
    join public.users u on u.id = s.user_id
    cross join lateral (
      select ((p_now at time zone s.timezone)::date - offs) as candidate_date
      from (values (0), (1)) as o (offs)
    ) d
    where u.telegram_id is not null
      -- schedules.timezone is client-writable and unvalidated; a single row
      -- with a bogus zone would make `at time zone s.timezone` raise and abort
      -- the whole tick (no alerts for anyone). Skip unknown zones so the blast
      -- radius is just that one user's slot.
      and s.timezone in (select name from pg_timezone_names)
      and extract(isodow from d.candidate_date)::smallint = any (s.days)
      and (p_now at time zone s.timezone) >= d.candidate_date + s.time
      and (p_now at time zone s.timezone) < d.candidate_date + s.time + interval '5 minutes'
  ),
  claimed as (
    insert into public.alert_deliveries (schedule_id, fire_date)
    select c.schedule_id, c.fire_date from candidates c
    on conflict (schedule_id, fire_date) do nothing
    returning schedule_id, fire_date
  )
  select c.schedule_id, c.user_id, c.telegram_id, c.slot_time, c.slot_timezone, c.fire_date
  from candidates c
  join claimed cl
    on cl.schedule_id = c.schedule_id and cl.fire_date = c.fire_date;
$$;

revoke execute on function public.claim_due_alert_slots(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_alert_slots(timestamptz) to service_role;

-- Vault-backed config, written by scripts/set-alert-cron.ts (mirrors
-- set_admin_org_id). Two secrets: dispatcher URL + shared cron secret.
create or replace function public.set_alert_cron_config(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url_id uuid;
  v_secret_id uuid;
begin
  select id into v_url_id from vault.secrets where name = 'alert_dispatcher_url';
  if v_url_id is null then
    perform vault.create_secret(p_url, 'alert_dispatcher_url',
      'Edge-function URL pg_cron posts alert ticks to');
  else
    perform vault.update_secret(v_url_id, p_url);
  end if;
  select id into v_secret_id from vault.secrets where name = 'alert_cron_secret';
  if v_secret_id is null then
    perform vault.create_secret(p_secret, 'alert_cron_secret',
      'Shared secret the alert-dispatcher function requires in x-cron-secret');
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;
end;
$$;

revoke execute on function public.set_alert_cron_config(text, text) from public, anon, authenticated;
grant execute on function public.set_alert_cron_config(text, text) to service_role;

-- The cron tick. Warns (visible in postgres logs) instead of erroring when
-- unconfigured, so a fresh local stack does not fail every minute.
create or replace function public.invoke_alert_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'alert_dispatcher_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'alert_cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'alert dispatcher unconfigured — run: yarn cron:set-secret <url> <secret>';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'x-cron-secret', v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.invoke_alert_dispatcher() from public, anon, authenticated;
grant execute on function public.invoke_alert_dispatcher() to service_role;

-- Versioned job definition (MRP-26 AC). cron.schedule upserts by name, so
-- db resets and re-applies are idempotent.
select cron.schedule(
  'alert-dispatcher-tick',
  '* * * * *',
  $$select public.invoke_alert_dispatcher()$$
);
