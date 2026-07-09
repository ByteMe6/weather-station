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
  status text not null default 'unregistered' check (status in ('unregistered', 'registered')),
  created_at timestamptz not null default now()
);

alter table public.devices enable row level security;

-- device_users (D2b)
create table public.device_users (
  device_id text not null references public.devices (device_id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (device_id, user_id)
);

create index if not exists device_users_user_id_idx on public.device_users (user_id);

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

create index if not exists readings_device_id_timestamp_idx
  on public.readings (device_id, timestamp desc);

alter table public.readings enable row level security;

-- schedules (D4)
create table public.schedules (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  time time not null,
  days smallint[] not null,
  created_at timestamptz not null default now()
);

create index if not exists schedules_user_id_idx on public.schedules (user_id);

alter table public.schedules enable row level security;

-- current_app_user_id(): maps the Clerk JWT `sub` claim to the internal
-- users.id (uuid). No-arg + STABLE so the planner evaluates it once per
-- query instead of per row. SECURITY DEFINER lets it read `users` even
-- though `users` itself has RLS enabled above.
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where clerk_user_id = (auth.jwt() ->> 'sub') limit 1;
$$;

-- users policies
create policy "users can view own profile"
  on public.users
  for select
  to authenticated
  using (id = public.current_app_user_id());

-- No client-path UPDATE policy: `clerk_user_id`/`telegram_id` are identity
-- linkage columns. Letting a client update its own row would let a user
-- overwrite telegram_id to squat on someone else's Telegram account link.
-- Account settings / Telegram linking are server-action-only (CLAUDE.md).
grant select on public.users to authenticated;

-- devices policies
-- devices.secret (HMAC key) must never be readable by any user-facing
-- policy — service-role only. The RLS policy below governs which rows are
-- visible, but column-level grants are what actually keep `secret` out of
-- reach, since row policies don't hide individual columns.
create policy "device members can view their devices"
  on public.devices
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.device_users du
      where du.device_id = devices.device_id
        and du.user_id = public.current_app_user_id()
    )
  );

revoke select on public.devices from authenticated, anon;
grant select (device_id, status, created_at) on public.devices to authenticated;

-- device_users policies
create policy "users can view their own device links"
  on public.device_users
  for select
  to authenticated
  using (user_id = public.current_app_user_id());

grant select on public.device_users to authenticated;

-- readings policies
create policy "device members can view readings"
  on public.readings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.device_users du
      where du.device_id = readings.device_id
        and du.user_id = public.current_app_user_id()
    )
  );

grant select on public.readings to authenticated;

-- schedules policies
create policy "users can view own schedules"
  on public.schedules
  for select
  to authenticated
  using (user_id = public.current_app_user_id());

create policy "users can insert own schedules"
  on public.schedules
  for insert
  to authenticated
  with check (user_id = public.current_app_user_id());

create policy "users can update own schedules"
  on public.schedules
  for update
  to authenticated
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id());

create policy "users can delete own schedules"
  on public.schedules
  for delete
  to authenticated
  using (user_id = public.current_app_user_id());

grant select, insert, update, delete on public.schedules to authenticated;
