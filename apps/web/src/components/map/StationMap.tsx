'use client'

import { divIcon } from 'leaflet'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

import type { StationPin } from './stationPins'

import 'leaflet/dist/leaflet.css'

// Required by the OSM tile usage policy and must stay visible.
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const SINGLE_PIN_ZOOM = 15
const MAX_FIT_ZOOM = 16

/**
 * Leaflet's default marker icon resolves its images by URL and breaks under
 * bundlers; a divIcon carries our own markup instead — and matches the
 * dashboard's language.
 */
const pinIcon = (name: string) =>
  divIcon({
    className: '',
    html: `<span class="ws-pin"><span class="ws-pin-dot"></span><span class="ws-pin-label">${name.replace(
      /[<>&"]/g,
      '',
    )}</span></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })

export const StationMap = ({
  pins,
  testId,
}: {
  pins: StationPin[]
  testId: string
}): ReactElement => {
  const center = useMemo<[number, number]>(
    () => [pins[0]?.latitude ?? 0, pins[0]?.longitude ?? 0],
    [pins],
  )
  const bounds = useMemo<[number, number][]>(
    () => pins.map((p) => [p.latitude, p.longitude]),
    [pins],
  )
  const boundsOptions = useMemo(
    () => ({ padding: [40, 40] as [number, number], maxZoom: MAX_FIT_ZOOM }),
    [],
  )

  return (
    <div
      data-testid={testId}
      className="rounded-card border-line h-80 w-full overflow-hidden border"
    >
      <MapContainer
        center={center}
        zoom={SINGLE_PIN_ZOOM}
        bounds={pins.length > 1 ? bounds : undefined}
        boundsOptions={boundsOptions}
        // A map that eats page scroll on a trackpad is a usability bug;
        // dragging and the +/- controls still zoom.
        scrollWheelZoom={false}
        className="size-full"
      >
        <TileLayer attribution={ATTRIBUTION} url={TILE_URL} />
        {pins.map((p) => (
          <Marker
            key={p.deviceId}
            position={[p.latitude, p.longitude]}
            icon={pinIcon(p.name)}
          >
            <Popup>
              <span className="flex flex-col gap-1">
                <b>{p.name}</b>
                <span className="font-mono text-[11px]">{p.deviceId}</span>
                <Link
                  data-testid={`${testId}-popup-${p.deviceId}-link`}
                  href={`/devices/${p.deviceId}`}
                  className="underline underline-offset-2"
                >
                  Open station
                </Link>
              </span>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
