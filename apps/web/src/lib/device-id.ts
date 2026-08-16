/** Provisioning mints lowercase ids (ws-<12 hex>, see infra/supabase-db/scripts/provision-device.ts); match that. */
export const normalizeDeviceId = (raw: string): string =>
  raw.trim().toLowerCase()
