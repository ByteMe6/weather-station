-- Station coordinates (follow-up to device profile): owners type latitude and
-- longitude themselves, the map on /devices draws a marker per located station.
-- No geocoding service is involved, so nothing leaves our stack on save.
alter table public.devices
  add column latitude numeric(8,6) check (latitude between -90 and 90),
  add column longitude numeric(9,6) check (longitude between -180 and 180);

-- Half a pair would put a marker on the equator or the prime meridian; the DB
-- refuses it so no code path has to defend against it.
alter table public.devices
  add constraint devices_coords_both_or_neither
  check ((latitude is null) = (longitude is null));

-- Column-list grant, exactly like label/address: devices has no blanket select
-- grant because devices.secret must stay unreadable on every user path.
grant select (latitude, longitude) on public.devices to authenticated;
