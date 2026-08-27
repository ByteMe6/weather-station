-- Multi-step bot flow state (menu-driven register / alert add). The webhook
-- function is stateless between updates, so the pending step lives here.
-- Service-role only: the Telegram identity never reaches a client session.
create table public.bot_sessions (
  telegram_id bigint primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.bot_sessions enable row level security;

-- No policies and no client grants on purpose. The postgres role's default
-- ACL on schema public still auto-grants TRUNCATE/REFERENCES/TRIGGER (all
-- RLS-exempt) to client roles on every new table, so revoke everything first
-- (same hazard the init migration documents); the grant below is the sole
-- surface. The init-migration blanket service_role grant predates this
-- table, so grant explicitly.
revoke all on public.bot_sessions from anon, authenticated;
grant select, insert, update, delete on public.bot_sessions to service_role;
