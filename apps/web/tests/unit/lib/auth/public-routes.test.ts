import { isPublicPath } from '@/lib/auth/public-routes'

describe('isPublicPath', () => {
  it.each([
    ['/', true],
    ['/sign-in', true],
    ['/sign-in/factor-one', true],
    ['/sign-up', true],
    ['/privacy', true],
    ['/api/v1/readings', true],
    ['/api/v1/health', true],
    ['/api/v1/openapi.json', true],
    // Key-authenticated: Clerk must let these through to withApiKey.
    ['/api/v1/stations', true],
    ['/api/v1/stations/ws-abc123/readings/aggregate', true],
    ['/api/webhooks/clerk', true],
    ['/reference', true],
    ['/api-docs', true],
    ['/dashboard', false],
    ['/devices/register', false],
    ['/settings', false],
  ])('%s → %s', (path, expected) => {
    expect(isPublicPath(path)).toBe(expected)
  })
})
