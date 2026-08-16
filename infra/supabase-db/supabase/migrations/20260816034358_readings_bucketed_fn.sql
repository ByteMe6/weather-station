-- MRP-34: server-side bucketing so 7 d / 30 d charts stay in the hundreds of
-- points (SVG limit, docs/research/03-chart-library.md). SECURITY INVOKER —
-- the readings RLS policy applies inside the function, so a non-member gets
-- zero rows. STABLE: read-only. Uses the (device_id, timestamp DESC) index.
create or replace function public.readings_bucketed(
  p_device_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket_minutes int
)
returns table (
  bucket timestamptz,
  avg_temperature numeric, min_temperature numeric, max_temperature numeric,
  avg_humidity numeric, min_humidity numeric, max_humidity numeric,
  avg_pressure numeric, min_pressure numeric, max_pressure numeric,
  avg_wind_speed numeric, max_wind_speed numeric,
  total_precipitation numeric,
  sample_count int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_bin(make_interval(mins => p_bucket_minutes), r.timestamp, p_from) as bucket,
    avg(r.temperature), min(r.temperature), max(r.temperature),
    avg(r.humidity), min(r.humidity), max(r.humidity),
    avg(r.pressure), min(r.pressure), max(r.pressure),
    avg(r.wind_speed), max(r.wind_speed),
    sum(r.precipitation),
    count(*)::int
  from public.readings r
  where r.device_id = p_device_id
    and r.timestamp >= p_from
    and r.timestamp <= p_to
    and p_bucket_minutes between 1 and 1440
  group by 1
  order by 1;
$$;

revoke execute on function public.readings_bucketed(text, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.readings_bucketed(text, timestamptz, timestamptz, int) to authenticated, service_role;
