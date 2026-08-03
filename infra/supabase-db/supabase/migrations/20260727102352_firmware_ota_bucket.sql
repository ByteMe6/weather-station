-- Public bucket for OTA firmware images and the version manifest. Devices
-- fetch anonymously via /storage/v1/object/public/firmware/...; uploads go
-- through scripts/ota_release.py with the service key (bypasses RLS).
insert into storage.buckets (id, name, public)
values ('firmware', 'firmware', true)
on conflict (id) do nothing;
