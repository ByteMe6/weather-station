-- MRP-28 Phase 3 exit metrics. Read-only: safe to run against production.
-- Run each block separately and paste the output into
-- docs/verification/phase-3-bot.md.

-- ---------------------------------------------------------------------------
-- 1. ALERT TIMELINESS (success metric: fired within 60 s of the slot time)
--    `lag` is how long after the configured local time the delivery was made.
select
  d.schedule_id,
  s.time                                        as slot_time,
  s.timezone,
  d.fire_date,
  d.status,
  d.created_at,
  d.created_at - ((d.fire_date + s.time) at time zone s.timezone) as lag
from public.alert_deliveries d
join public.schedules s on s.id = d.schedule_id
order by d.created_at desc
limit 200;

-- 1b. The metric itself, as one row. `within_60s` must equal `total`,
--     and `failed` must be 0, for the success metric to hold.
select
  count(*)                                                          as total,
  count(*) filter (where d.status = 'sent')                         as sent,
  count(*) filter (where d.status <> 'sent')                        as failed,
  count(*) filter (
    where d.created_at - ((d.fire_date + s.time) at time zone s.timezone)
          between interval '0 s' and interval '60 s'
  )                                                                 as within_60s,
  max(d.created_at - ((d.fire_date + s.time) at time zone s.timezone)) as worst_lag,
  min(d.created_at)::date                                           as first_day,
  max(d.created_at)::date                                           as last_day,
  count(distinct d.created_at::date)                                as days_observed
from public.alert_deliveries d
join public.schedules s on s.id = d.schedule_id;

-- 1c. Any delivery that missed the window or failed — these become findings.
select d.schedule_id, s.time, s.timezone, d.fire_date, d.status, d.error,
       d.created_at - ((d.fire_date + s.time) at time zone s.timezone) as lag
from public.alert_deliveries d
join public.schedules s on s.id = d.schedule_id
where d.status <> 'sent'
   or d.created_at - ((d.fire_date + s.time) at time zone s.timezone)
      not between interval '0 s' and interval '60 s'
order by d.created_at desc;

-- ---------------------------------------------------------------------------
-- 2. DOUBLE-FIRE GUARD: the (schedule_id, fire_date) unique index means this
--    must return zero rows, always.
select schedule_id, fire_date, count(*)
from public.alert_deliveries
group by schedule_id, fire_date
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- 3. ISOLATION: no device may have two owners, and every registered device
--    must have exactly one. Both queries must return zero rows.
select device_id, count(*) as owners
from public.device_users
where role = 'owner'
group by device_id
having count(*) <> 1;

select d.device_id, d.status
from public.devices d
where d.status = 'registered'
  and not exists (select 1 from public.device_users du where du.device_id = d.device_id);

-- ---------------------------------------------------------------------------
-- 4. IDENTITY HEALTH (MRP-39): after the merge shipped there must be no
--    duplicate human — i.e. no telegram-only row whose devices overlap a
--    Clerk row's. A telegram-only row with its own devices is legitimate
--    (a Telegram-first user who never signed up on the web).
select
  count(*) filter (where clerk_user_id is not null and telegram_id is not null) as linked_both,
  count(*) filter (where clerk_user_id is not null and telegram_id is null)     as web_only,
  count(*) filter (where clerk_user_id is null and telegram_id is not null)     as telegram_only,
  count(*) filter (where clerk_user_id is null and telegram_id is null)         as orphaned
from public.users;

-- 4b. Orphaned rows (neither identity) should never exist.
select id, created_at from public.users
where clerk_user_id is null and telegram_id is null;

-- ---------------------------------------------------------------------------
-- 5. /current LATENCY INPUT: confirms the query /current runs is index-served.
--    Expect an Index Scan using readings_device_id_timestamp_idx, not a Seq Scan.
explain (analyze, buffers)
select temperature, humidity, pressure, wind_speed, wind_direction,
       precipitation, timestamp
from public.readings
where device_id = (select device_id from public.devices limit 1)
order by timestamp desc
limit 1;

-- ---------------------------------------------------------------------------
-- 6. CRON: the dispatcher must be registered and running every minute.
select jobid, schedule, jobname, active from cron.job;

select jobid, status, start_time, end_time, return_message
from cron.job_run_details
order by start_time desc
limit 20;
