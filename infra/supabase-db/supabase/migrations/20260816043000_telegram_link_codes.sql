-- MRP-37: one-time codes proving Telegram account ownership. Created by the
-- web (server action), consumed by the bot (/start link_<code>). Server-side
-- only: no client policies, no grants to anon/authenticated.
create table public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_reason text,
  created_at timestamptz not null default now()
);
create index telegram_link_codes_user_id_idx on public.telegram_link_codes (user_id);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;
grant all on public.telegram_link_codes to service_role;
