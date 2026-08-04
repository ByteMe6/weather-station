-- MRP-15: the shipped hardware is a BMP280, which has no humidity sensor.
-- Readings from those devices carry a null humidity rather than being rejected
-- at ingest. Bounds (0-100) still apply when a value is present - that is
-- enforced by the zod schema on the ingest route, not by a column constraint.
alter table public.readings
  alter column humidity drop not null;
