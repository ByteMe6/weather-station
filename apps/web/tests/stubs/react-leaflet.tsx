/* Test stub for `react-leaflet`: renders plain elements so marker/popup
   content can be asserted without Leaflet touching the DOM or `window`. */
import type { ReactElement, ReactNode } from 'react'

export const MapContainer = ({
  children,
}: {
  children?: ReactNode
}): ReactElement => <div data-testid="map-container">{children}</div>

export const TileLayer = ({
  attribution,
  url,
}: {
  attribution: string
  url: string
}): ReactElement => (
  <div data-testid="tile-layer" data-attribution={attribution} data-url={url} />
)

export const Marker = ({
  children,
  position,
}: {
  children?: ReactNode
  position: [number, number]
}): ReactElement => (
  <div data-testid="marker" data-position={position.join(',')}>
    {children}
  </div>
)

export const Popup = ({ children }: { children?: ReactNode }): ReactElement => (
  <div data-testid="popup">{children}</div>
)

export const mapCalls = {
  fitBounds: [] as unknown[][],
  setView: [] as unknown[][],
}

export const useMap = () => ({
  fitBounds: (...args: unknown[]) => {
    mapCalls.fitBounds.push(args)
  },
  setView: (...args: unknown[]) => {
    mapCalls.setView.push(args)
  },
})
