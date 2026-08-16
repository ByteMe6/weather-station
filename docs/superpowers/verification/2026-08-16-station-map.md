# Station map — verification

**Date:** 2026-08-16
**Branch:** `feature/web-station-map`
**Plan:** `docs/superpowers/plans/2026-08-16-station-map.md`
**How:** real Chrome profile (Claude extension) against the local stack on
`:3001`, two seeded stations — `Backyard` (Lviv, located) and `Rooftop`
(initially without coordinates).

## Gate

| Check                                  | Result                                      |
| -------------------------------------- | ------------------------------------------- |
| `yarn format:check`                    | ✅ clean                                     |
| `yarn lint`                            | ✅ 3/3 workspaces                            |
| `yarn check-types`                     | ✅ 3/3 workspaces                            |
| `yarn test:unit`                       | ✅ 7 shared + 227 web                        |
| `test:integration:secrets`             | ✅ 11                                        |
| `db-reset:local` + `test:db` (pgTAP)   | ✅ PASS from a clean database, 8 suites      |
| `infisical run -- yarn build`          | ✅ `/devices` builds with Leaflet in the tree |

## Browser checks

| # | Check                                                       | Result                                                                 |
| - | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1 | Station without coordinates → hint, no marker                | ✅ hint on `Rooftop` only; map card showed just `Backyard`               |
| 2 | Adding coordinates makes the marker appear without a reload  | ✅ saved in the dialog, went back, both markers present                  |
| 3 | Pasting `50.4501, 30.5234` into latitude fills both fields   | ✅ split to `50.4501` / `30.5234`                                        |
| 4 | Latitude `91` → inline error, nothing saved                  | ✅ "latitude must be between -90 and 90", dialog stayed open             |
| 5 | `© OpenStreetMap contributors` attribution visible           | ✅ present in both themes                                                |
| 6 | Marker popup "Open station" links to the station             | ✅ `/devices/ws-a2a6956f3744`                                            |
| 7 | Dark mode legible                                            | ✅ tile pane filter `invert(1) hue-rotate(180deg)`; attribution restyled |
| 8 | Mobile width (390 px)                                        | ✅ map 300×320, no horizontal page overflow                              |
| 9 | Console clean, tiles only for the visible area               | ✅ no errors after the fixes below; 10 tiles for one viewport            |

## Bugs found in verification (and fixed)

1. **Marker dot rendered 0 px wide.** `.ws-pin-dot` is a flex item inside the
   12 px icon container, so the label squeezed it to nothing — only the text
   showed. Fixed with `flex: none` on the dot.
2. **Attribution used Leaflet's white-on-anything default**, which read badly
   against the dark theme. Now themed with `--color-card`/`--color-slate` and
   real contrast in both modes — it must stay legible, the tile policy requires
   the attribution be visible.
3. **The map never refit when the pins changed.** `MapContainer` applies
   `center`/`zoom`/`bounds` only at initialisation, so a station that gained
   coordinates left the view where it was — the second station was off-screen
   even though its marker existed. Added a `FitToPins` child that calls
   `fitBounds`/`setView` through `useMap()` whenever the positions change, with
   a regression test asserting both branches.
4. **`TypeError: … reading '_leaflet_pos'` and "Map container is being reused".**
   React's double-invoked effects tore the map down between the effect running
   and Leaflet's animated pan reading the pane. Fixed by bailing out when
   `map.getContainer().isConnected` is false and passing `animate: false` —
   this is an initial framing, not a transition worth animating. Console is
   clean afterwards.

## Not covered here

- Real-device / production-domain check (tile Referer behaviour on the Vercel
  domain) — do it with the prod rollout.
- A second Clerk account viewing a shared located station: RLS already scopes
  `devices` rows, and the integration suite covers the read, but the UI walk
  with two real accounts is still outstanding (same gap as sharing).
