-- Device profile: a member-set nickname and free-text address for a station.
-- Both are properties of the device (shared by every member), so they live on
-- devices. Reads go through the existing member policy; the column-list grant
-- is extended (never a blanket grant — devices.secret must stay unreadable).
-- Writes are server-action only (role check in code), so no client UPDATE
-- policy is added. That check was owner-only when this shipped and is
-- owners-and-editors since MRP-48; the authority of the day lives in
-- actions/devices.action.ts, not here. Comment-only edit to an applied
-- migration — no schema statement changed, so re-running is a no-op.
alter table public.devices
  add column label text check (label is null or char_length(label) between 1 and 40),
  add column address text check (address is null or char_length(address) between 1 and 200);

grant select (label, address) on public.devices to authenticated;
