import {
  generateLinkCode,
  isValidBotUsername,
  normalizeBotUsername,
  telegramDeepLink,
} from '@/lib/telegram'

describe('telegram link helpers', () => {
  it('builds the deep link and generates 20-char codes', () => {
    expect(telegramDeepLink('WsWeatherBot', 'ABC')).toBe(
      'https://t.me/WsWeatherBot?start=link_ABC',
    )
    expect(generateLinkCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    expect(generateLinkCode()).not.toBe(generateLinkCode())
  })

  // BotFather shows the username as `@WsWeatherBot` and links the bot as a
  // t.me URL; both get pasted into NEXT_PUBLIC_TELEGRAM_BOT_USERNAME as-is.
  // `https://t.me/@WsWeatherBot?start=…` does not open the bot, so linking
  // died at the tap with nothing to show for it.
  it.each([
    ['WsWeatherBot', 'WsWeatherBot'],
    ['@WsWeatherBot', 'WsWeatherBot'],
    ['  @WsWeatherBot  ', 'WsWeatherBot'],
    ['https://t.me/WsWeatherBot', 'WsWeatherBot'],
    ['http://telegram.me/WsWeatherBot', 'WsWeatherBot'],
    ['t.me/WsWeatherBot', 'WsWeatherBot'],
    ['https://t.me/WsWeatherBot?start=x', 'WsWeatherBot'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeBotUsername(raw)).toBe(expected)
  })

  it('normalises inside the deep link too', () => {
    expect(telegramDeepLink('@WsWeatherBot', 'ABC')).toBe(
      'https://t.me/WsWeatherBot?start=link_ABC',
    )
  })

  it('validates Telegram username rules (5-32 word characters)', () => {
    expect(isValidBotUsername('WsWeatherBot')).toBe(true)
    expect(isValidBotUsername('ws_weather_bot_1')).toBe(true)
    expect(isValidBotUsername('')).toBe(false)
    expect(isValidBotUsername('abc')).toBe(false)
    expect(isValidBotUsername('@WsWeatherBot')).toBe(false)
    expect(isValidBotUsername('has space')).toBe(false)
    expect(isValidBotUsername('a'.repeat(33))).toBe(false)
  })
})
