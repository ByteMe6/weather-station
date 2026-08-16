# Station map — design

**Date:** 2026-08-16
**Ticket:** follow-up to MRP-38 (station nickname/address); no Linear issue yet
**Status:** approved for planning

## 1. Goal

Owners can give a station coordinates, and every member sees their stations as
markers on a map on `/devices`. The map answers one question — _where are my
stations?_ — for a user with more than one, and gives a single station a sense
of place.

Explicitly **not** a goal: finding places, searching, routing, sharing
locations publicly, or showing anyone else's stations.

## 2. Constraints that shaped the design

| Constraint                       | Consequence                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free, no billing account         | Google Maps is out: its JS API needs an API key on a Cloud project **with billing enabled**, even inside the free allowance. Leaflet + OpenStreetMap raster tiles need no key, no account, no card. |
| No geocoding dependency          | Owners type latitude/longitude themselves. Nothing is sent to a geocoder, so the [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) never applies. |
| OSM tile usage policy            | Attribution is mandatory and always visible; interactive viewing only — no pre-fetching tiles, no offline archive, no bulk download. The design satisfies these structurally (see §6). |
| Coordinates are personal data    | A station is usually someone's home. Same RLS scope as the rest of the device row: members only. Documented in `docs/privacy-data-minimisation.md`.            |
| React 19.2 / Next 16 (Turbopack) | `react-leaflet@5` declares `react@^19` — a match. Leaflet touches `window` at import time, so the map must be a `next/dynamic` import with `ssr: false`.        |

## 3. Data model

One migration adds two nullable columns to `public.devices`:

```sql
alter table public.devices
  add column latitude  numeric(8,6) check (latitude  between -90  and 90),
  add column longitude numeric(9,6) check (longitude between -180 and 180),
  add constraint devices_coords_both_or_neither
    check ((latitude is null) = (longitude is null));

grant select (latitude, longitude) on public.devices to authenticated;
```

- **Nullable**: every existing station starts without coordinates, and a
  station never _needs_ them.
- **Both-or-neither**: half a coordinate pair is meaningless and would place a
  marker on the equator or the prime meridian. The database refuses it, so no
  code path has to defend against it.
- **`numeric(8,6)` / `numeric(9,6)`**: six decimals ≈ 0.11 m — far past what a
  phone GPS delivers. Latitude needs two integer digits, longitude three.
- **Column-list grant**, matching `label`/`address`: `devices` has no blanket
  `select` grant, and `devices.secret` must stay unreadable by any user path.
- **No index.** `devices` is small and is never queried by bounding box; the
  map filters in JavaScript over rows already fetched.

`yarn regenerate:types` after the migration, as always.

## 4. Write path — extend, do not add

Coordinates are edited in the existing owner-only "Station details" dialog and
saved by the existing `updateDeviceProfileAction`. No new server action: the
authorization story (service role + explicit `requireOwner`) is already
correct, and a second action would duplicate it.

The action's zod schema gains:

```ts
latitude: coordinateField(-90, 90),
longitude: coordinateField(-180, 180),
```

where `coordinateField` trims, treats an empty string as `null`, rejects
anything non-numeric, and enforces the range. A superrefine enforces
both-or-neither with the error attached to whichever field is empty, so the
form highlights the field the owner must fill.

### Paste affordance

Copying a pin from a phone or a maps app yields `49.839700, 24.029700` — one
string containing both numbers. Pasting that into the latitude field splits it
across both fields instead of failing validation. This lives in a pure helper
(`parseCoordinateInput`) so it is unit-testable without a DOM:

```ts
parseCoordinateInput('49.8397, 24.0297') // → { latitude: '49.8397', longitude: '24.0297' }
parseCoordinateInput('49.8397')          // → { latitude: '49.8397' }
```

## 5. Read path — no new query

`latitude` and `longitude` join the column list of `fetchMyDevices` and the
`MyDevice.device` type. Consequences:

- The map and the station list read the same TanStack cache entry
  (`deviceKeys.mine`) — **no additional request** for the map.
- Saving coordinates already invalidates `deviceKeys.mine`, so the marker moves
  as soon as the dialog closes. No extra invalidation.
- RLS decides what the map can show, exactly as it decides what the list shows.

A pure selector keeps the filtering out of the component:

```ts
export interface StationPin {
  deviceId: string
  name: string
  latitude: number
  longitude: number
}
export const stationPins = (devices: MyDevice[]): StationPin[]
```

## 6. Map component

`components/map/StationMap.tsx` — `'use client'`, rendered through
`next/dynamic` with `ssr: false` from a thin `StationMapCard` wrapper.

| Decision                                                                              | Why                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TileLayer` with `attribution="&copy; OpenStreetMap contributors"`                    | Required by the tile policy, must stay visible — never hidden behind a toggle.                                                                            |
| Custom `divIcon` markers, not Leaflet's default icon                                  | The default icon's image URLs break under bundlers (the classic missing-marker bug), and our own markup matches the dashboard: a sky dot with the station name. |
| `fitBounds` over all pins, `maxZoom` capped; a single pin gets a fixed zoom (15)       | One rule that works for one station and for ten.                                                                                                          |
| Popup: station name, device id, "Open station" link to `/devices/[id]`                 | The map is a navigation aid, not a second detail view.                                                                                                    |
| `leaflet/dist/leaflet.css` imported inside the component                              | Keeps the CSS with the only route that loads the map.                                                                                                     |
| Dark mode: CSS filter on the tile pane under `.dark`                                  | OSM raster tiles are light-only. Cosmetic, one rule, reversible.                                                                                          |
| Fixed height (~320 px), `width: 100%`, `scrollWheelZoom={false}`                       | A map that swallows page scroll on a laptop trackpad is a usability bug; drag and +/- controls still zoom.                                                |

Policy compliance is structural: the component only ever displays tiles for the
area the user is looking at. Nothing pre-fetches, seeds, or caches tiles beyond
the browser's own HTTP cache.

## 7. Placement and empty states

On `/devices`, above the station list:

| Situation                              | What renders                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No stations at all                      | The existing `NoDeviceState` — no map.                                                                   |
| Stations, none with coordinates         | No map card. A one-line hint on the list: owners see "Add coordinates in station details to see stations on a map." |
| At least one station with coordinates   | Map card with a marker per located station.                                                              |
| Some located, some not                  | Map shows the located ones; each unlocated row keeps the hint (owners only).                             |

The dashboard and device-detail pages get no map (§9).

## 8. Bundle cost

`leaflet` is ~43 KB gzipped plus a small `react-leaflet` wrapper. The dynamic
import keeps it out of the shared chunk, so only `/devices` pays, and only
after that route renders.

## 9. Out of scope (YAGNI)

Geocoding or address search; marker clustering (it earns its place in the
hundreds, not the handful); drag-to-place or map-click-to-set coordinates;
offline tiles; maps on the dashboard or device detail; public/shared station
maps; altitude.

## 10. Privacy

- Coordinates sit in the `devices` row and inherit its RLS scope: only members
  of that device can read them. Owners alone can write them.
- The `device_members()` masking work is unaffected — coordinates describe a
  station, not a person, and are never returned by that RPC.
- `docs/privacy-data-minimisation.md` gains a `devices.latitude/longitude` row:
  purpose (locating your own stations on a map), retention (until the owner
  clears it or the device is re-provisioned), verdict (optional, user-entered).
- Honest disclosure to add to the privacy page: displaying a map means the
  browser requests tiles from OpenStreetMap's servers, which reveals the map
  area being viewed to them — never a station id, an account, or a reading.

## 11. Testing

| Layer       | Coverage                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit        | `parseCoordinateInput` (plain, pasted pair, whitespace, junk); the action's schema (range violations, both-or-neither, clearing both); `stationPins`; `StationMap` markers against a stubbed `react-leaflet` (jsdom cannot run Leaflet); `DevicesIndex` hint states. |
| Integration | Owner saves coordinates and reads them back; a non-owner member is rejected; a member can read the columns; clearing to null works.                                |
| pgTAP       | Column grants for `authenticated`; `secret` still unreadable; range checks reject 91 / -181; both-or-neither rejects a half pair.                                   |
| Browser     | Verified in the real Chrome profile: markers for two seeded stations, popup link navigates, attribution visible, dark mode legible, mobile width.                   |

## 12. Risks

| Risk                                                              | Mitigation                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| OSM blocks a client sending no identifying Referer                 | Browsers send Referer by default; confirm no restrictive `Referrer-Policy` header is set for the app. Verify in the browser.    |
| Leaflet imported on the server breaks the build                    | `ssr: false` dynamic import, plus a production `yarn build` in the verification gate.                                            |
| Owner enters swapped lat/lng (marker lands in the wrong hemisphere) | Range checks catch the impossible cases; the map itself shows the mistake immediately, and the fields stay editable.            |
| Tile policy changes                                                | The tile URL lives in one constant; switching to another raster provider is a one-line change.                                  |
