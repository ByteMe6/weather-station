import type { CardAccent } from '@/components/ui/Card'

export type ParameterKey =
  | 'temperature'
  | 'humidity'
  | 'pressure'
  | 'windSpeed'
  | 'windDirection'
  | 'precipitation'

export interface ParameterMeta {
  key: ParameterKey
  label: string
  unit: string
  decimals: number
  accent: CardAccent
  cssVar: string
}

/** Display order and presentation for every sensor parameter (spec §4.2). */
export const PARAMETERS: readonly ParameterMeta[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    unit: '°C',
    decimals: 1,
    accent: 'temp',
    cssVar: 'var(--color-temp)',
  },
  {
    key: 'humidity',
    label: 'Humidity',
    unit: '%',
    decimals: 0,
    accent: 'hum',
    cssVar: 'var(--color-hum)',
  },
  {
    key: 'pressure',
    label: 'Pressure',
    unit: 'hPa',
    decimals: 1,
    accent: 'press',
    cssVar: 'var(--color-press)',
  },
  {
    key: 'windSpeed',
    label: 'Wind',
    unit: 'km/h',
    decimals: 0,
    accent: 'wind',
    cssVar: 'var(--color-wind)',
  },
  {
    key: 'windDirection',
    label: 'Wind direction',
    unit: '°',
    decimals: 0,
    accent: 'wind',
    cssVar: 'var(--color-wind)',
  },
  {
    key: 'precipitation',
    label: 'Precipitation',
    unit: 'mm',
    decimals: 1,
    accent: 'rain',
    cssVar: 'var(--color-rain)',
  },
] as const

const BY_KEY = new Map(PARAMETERS.map((p) => [p.key, p]))
export const parameterMeta = (key: ParameterKey): ParameterMeta =>
  BY_KEY.get(key)!
