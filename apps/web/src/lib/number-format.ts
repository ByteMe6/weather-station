export const formatNumber = (value: number, decimals: number): string =>
  Number.isFinite(value) ? value.toFixed(decimals) : '—'
