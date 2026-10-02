-- Public station API (docs/superpowers/specs/2026-10-01-public-read-api-design.md):
-- personal API keys for users' own scripts, and a provider-independent rate
-- limiter. Both are service-role only — the same posture as devices.secret
-- and bot_sessions: RLS on, no policies, no client grants.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- Lowercase hex SHA-256 of the full key; the key itself is never stored.
  -- A fast deterministic hash is correct here (not bcrypt/argon2): keys carry
  -- 256 random bits, so brute force is infeasible, and lookup stays one
  -- indexed equality. Text, not bytea, so supabase-js passes it unescaped.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  -- Last 4 characters, so Settings can tell keys apart without the secret.
  key_hint text not null check (char_length(key_hint) = 4),
  -- Mirrors API_KEY_SCOPES in @ws/shared.
  scope text not null check (scope in ('read', 'read_write')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  -- Soft delete, so the Settings list can still show a revoked key.
  revoked_at timestamptz
);

create index api_keys_user_id_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
grant select, insert, update, delete on public.api_keys to service_role;

-- One row per bucket; the window resets in place, so nothing needs sweeping.
-- `bucket` is an opaque string ('key:<id>'), deliberately NOT a foreign key to
-- api_keys: the limiter must keep working unchanged if keys move to Clerk
-- (spec §11), whose ids are 'ak_…' strings that never appear in this database.
create table public.api_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  count int not null
);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

-- Resolve a key hash to its owner and scope; stamp last_used_at at most once
-- a minute so a polling script does not rewrite the row on every request.
-- Returns no row for unknown, revoked and expired keys — the caller answers
-- the same 401 for all three. out_-prefixed so the OUT names cannot shadow the
-- api_keys columns this function reads (see update_device_profile).
create or replace function public.api_key_authenticate(p_key_hash text)
returns table (out_key_id uuid, out_user_id uuid, out_scope text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_user_id uuid;
  v_scope text;
begin
  select k.id, k.user_id, k.scope
    into v_id, v_user_id, v_scope
    from public.api_keys k
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now());

  if v_id is null then
    return;
  end if;

  -- Throttle inside the UPDATE: under READ COMMITTED a concurrent request
  -- re-checks the predicate against the committed row and skips the write.
  update public.api_keys k set last_used_at = now()
   where k.id = v_id
     and (k.last_used_at is null or k.last_used_at < now() - interval '1 minute');

  out_key_id := v_id;
  out_user_id := v_user_id;
  out_scope := v_scope;
  return next;
end;
$$;

revoke execute on function public.api_key_authenticate(text) from public, anon, authenticated;
grant execute on function public.api_key_authenticate(text) to service_role;

-- Fixed-window counter. Limit and window are arguments so the numbers live in
-- @ws/shared (API_RATE_LIMIT), not here. One atomic upsert: concurrent hits on
-- the same bucket serialise on the row. A refused hit still counts.
create or replace function public.api_rate_limit_hit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns table (out_allowed boolean, out_remaining int, out_reset_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  if p_bucket is null or p_limit is null or p_window_seconds is null
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'API_RATE_LIMIT_INVALID' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.api_rate_limits as r (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket) do update
    -- greatest(): a late-committing hit from the previous window must not move the window backwards.
    set window_start = greatest(r.window_start, excluded.window_start),
        count = case when r.window_start < excluded.window_start then 1 else r.count + 1 end
  returning r.count into v_count;

  out_allowed := v_count <= p_limit;
  out_remaining := greatest(p_limit - v_count, 0);
  out_reset_at := v_window + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

revoke execute on function public.api_rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.api_rate_limit_hit(text, int, int) to service_role;
