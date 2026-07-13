-- Initial schema (PRD D1-D4): users, devices, device_users, readings, schedules.
-- readings_daily (D3b) is deferred to Phase 5 retention work.

-- users (D1)
create table public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique,
  telegram_id bigint unique,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- devices (D2)
create table public.devices (
  device_id text primary key,
  secret text not null,
  -- status values mirror DeviceStatus in @ws/shared — keep the two lists in
  -- sync (generated types widen this to `string`, so the shared union isn't
  -- enforced across the wire; a mismatch surfaces only as a 23514 at runtime).
  status text not null default 'unregistered' check (status in ('unregistered', 'registered')),
  created_at timestamptz not null default now()
);

alter table public.devices enable row level security;

-- device_users (D2b)
create table public.device_users (
  device_id text not null references public.devices (device_id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- role values mirror DeviceRole in @ws/shared — keep the two lists in sync.
  role text not null check (role in ('owner', 'editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (device_id, user_id)
);

create index device_users_user_id_idx on public.device_users (user_id);

alter table public.device_users enable row level security;

-- readings (D3)
create table public.readings (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices (device_id) on delete cascade,
  timestamp timestamptz not null,
  temperature numeric not null,
  humidity numeric not null,
  pressure numeric not null,
  wind_speed numeric,
  wind_direction numeric,
  precipitation numeric
);

-- Unique, not just indexed: firmware retries (PRD F6) can re-send an
-- already-ingested reading within the HMAC replay window (freshness-only,
-- not a dedup check). The ingest route must treat 23505 as a successful no-op
-- (on conflict do nothing) so a retry doesn't burn the device's attempts.
create unique index readings_device_id_timestamp_idx
  on public.readings (device_id, timestamp desc);

alter table public.readings enable row level security;

-- schedules (D4)
create table public.schedules (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  time time not null,
  -- IANA name (PRD OQ7: alerts fire in the user's timezone, inferred from
  -- their device or set explicitly per slot); defaulted to UTC so existing
  -- rows never end up with an ambiguous stored time.
  timezone text not null default 'UTC',
  -- ISO weekday numbers, 1 = Monday ... 7 = Sunday (matches AlertSchedule.days
  -- in @ws/shared). Client-writable, so constrained here since no app-layer
  -- validation exists yet.
  days smallint[] not null check (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[] and cardinality(days) > 0),
  created_at timestamptz not null default now()
);

create index schedules_user_id_idx on public.schedules (user_id);

alter table public.schedules enable row level security;

-- Self-contained privilege posture: don't rely on whichever Supabase CLI
-- version initialized the stack (older CLIs auto-grant ALL, including
-- RLS-exempt TRUNCATE, to anon/authenticated/service_role on every new
-- table). Revoke everything up front; the grants below are the sole surface.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

-- current_app_user_id(): maps the Clerk JWT `sub` claim to the internal
-- users.id (uuid). SECURITY DEFINER lets it read `users` even though `users`
-- itself has RLS enabled above; search_path is pinned empty with every
-- identifier schema-qualified, so it can't be hijacked by a search-path
-- change. STABLE only *permits* once-per-statement evaluation — it does not
-- force it for a SECURITY DEFINER function, so every policy below wraps the
-- call as `(select public.current_app_user_id())` to force a single
-- InitPlan instead of one evaluation per row (Supabase lint 0003_auth_rls_initplan).
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.users where clerk_user_id = (auth.jwt() ->> 'sub');
$$;

revoke execute on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated, service_role;

-- Keeps devices.status in sync with the D2 invariant
-- status='registered' <=> has at least one device_users row: without this,
-- removing the last member stranded a device as permanently 'registered'
-- (unclaimable, invisible to every user, yet still accepting ingest writes).
create or replace function public.maintain_device_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.device_users where device_id = old.device_id
  ) then
    update public.devices set status = 'unregistered' where device_id = old.device_id;
  end if;
  return old;
end;
$$;

create trigger device_users_after_delete
  after delete on public.device_users
  for each row
  execute function public.maintain_device_status();

-- users policies
create policy "users can view own profile"
  on public.users
  for select
  to authenticated
  using (id = (select public.current_app_user_id()));

-- No client-path UPDATE policy: `clerk_user_id`/`telegram_id` are identity
-- linkage columns. Letting a client update its own row would let a user
-- overwrite telegram_id to squat on someone else's Telegram account link.
-- Account settings / Telegram linking are server-action-only (CLAUDE.md).
grant select on public.users to authenticated;

-- devices policies
-- devices.secret (HMAC key) must never be readable by any user-facing
-- policy — service-role only. The RLS policy below governs which rows are
-- visible, but column-level grants are what actually keep `secret` out of
-- reach, since row policies don't hide individual columns. IMPORTANT: any
-- future migration must keep granting SELECT on an explicit column list for
-- `devices` — a blanket `grant select on public.devices to authenticated`
-- would silently re-expose `secret` to every device member.
create policy "device members can view their devices"
  on public.devices
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.device_users du
      where du.device_id = devices.device_id
        and du.user_id = (select public.current_app_user_id())
    )
  );

grant select (device_id, status, created_at) on public.devices to authenticated;

-- device_users policies
create policy "users can view their own device links"
  on public.device_users
  for select
  to authenticated
  using (user_id = (select public.current_app_user_id()));

grant select on public.device_users to authenticated;

-- readings policies
create policy "device members can view readings"
  on public.readings
  for select
  to authenticated
  using (
    device_id in (
      select du.device_id
      from public.device_users du
      where du.user_id = (select public.current_app_user_id())
    )
  );

grant select on public.readings to authenticated;

-- schedules policies
create policy "users can view own schedules"
  on public.schedules
  for select
  to authenticated
  using (user_id = (select public.current_app_user_id()));

create policy "users can insert own schedules"
  on public.schedules
  for insert
  to authenticated
  with check (user_id = (select public.current_app_user_id()));

create policy "users can update own schedules"
  on public.schedules
  for update
  to authenticated
  using (user_id = (select public.current_app_user_id()))
  with check (user_id = (select public.current_app_user_id()));

create policy "users can delete own schedules"
  on public.schedules
  for delete
  to authenticated
  using (user_id = (select public.current_app_user_id()));

grant select, insert, update, delete on public.schedules to authenticated;

-- Identity-column sequences aren't covered by table-level grants — the
-- inserting role needs explicit USAGE or `insert into schedules` 42501s.
grant usage, select on all sequences in schema public to authenticated;

-- service_role (server actions, device ingest, Telegram bot) bypasses RLS
-- but NOT table grants — BYPASSRLS does not imply privileges. Without this,
-- every server path (device ingest, registration/sharing, Telegram linking,
-- CSV export) fails closed with 42501.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
