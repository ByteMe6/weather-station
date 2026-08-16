import { generateLinkCode, telegramDeepLink } from '@/lib/telegram'

describe('telegram link helpers', () => {
  it('builds the deep link and generates 20-char codes', () => {
    expect(telegramDeepLink('WsWeatherBot', 'ABC')).toBe(
      'https://t.me/WsWeatherBot?start=link_ABC',
    )
    expect(generateLinkCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    expect(generateLinkCode()).not.toBe(generateLinkCode())
  })
})
