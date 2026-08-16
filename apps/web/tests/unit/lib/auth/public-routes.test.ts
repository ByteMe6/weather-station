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
