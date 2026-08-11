export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Liveness only — no external calls, so uptime polling never blocks on the DB. */
export const GET = async (): Promise<Response> =>
  Response.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
