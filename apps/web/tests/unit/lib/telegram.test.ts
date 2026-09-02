import {
  botChatUrl,
  configuredBotUsername,
  generateLinkCode,
  isValidBotUsername,
  normalizeBotUsername,
  telegramDeepLink,
} from '@/lib/telegram'

const CODE = 'ABCDEFGHJKMNPQRSTVWX'

describe('telegram link helpers', () => {
  const original = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
  afterEach(() => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = original
  })

  it('generates 20-char codes', () => {
    expect(generateLinkCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    expect(generateLinkCode()).not.toBe(generateLinkCode())
  })

  // BotFather shows the username as `@WsWeatherBot` and links the bot as a
  // t.me URL; both get pasted into the env var as-is.
  it.each([
    ['WsWeatherBot', 'WsWeatherBot'],
    ['@WsWeatherBot', 'WsWeatherBot'],
    ['  @WsWeatherBot  ', 'WsWeatherBot'],
    ['https://t.me/WsWeatherBot', 'WsWeatherBot'],
    ['http://telegram.me/WsWeatherBot', 'WsWeatherBot'],
    ['t.me/WsWeatherBot', 'WsWeatherBot'],
    ['t.me/WsWeatherBot/', 'WsWeatherBot'],
    ['https://t.me/WsWeatherBot?start=x', 'WsWeatherBot'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeBotUsername(raw)).toBe(expected)
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

  // A t.me route is shaped exactly like a username, so neither the regex nor a
  // "keep the first path segment" normaliser can tell them apart — a pasted
  // route used to come out valid and link somewhere real but wrong.
  it.each([
    'https://t.me/joinchat/AAA',
    'https://t.me/share/url?url=a',
    'https://t.me/proxy?server=x',
    'https://t.me/socks?server=x',
    'https://t.me/login/12345',
    'https://t.me/addstickers/x',
    'https://t.me/setlanguage/x',
  ])('refuses the t.me route %j instead of linking to it', (raw) => {
    expect(telegramDeepLink(raw, CODE)).toBeNull()
  })

  // Mutation guard. These are the only assertions that pin the null contract on
  // a function production actually calls: with them absent, deleting the
  // validation from telegramDeepLink and configuredBotUsername left the whole
  // suite green while `https://t.me/my bot?start=…` shipped into the anchor and
  // the QR code.
  it('refuses to build a deep link from an unusable username', () => {
    expect(telegramDeepLink('my bot', CODE)).toBeNull()
    expect(telegramDeepLink('', CODE)).toBeNull()
    expect(telegramDeepLink('abc', CODE)).toBeNull()
    expect(telegramDeepLink('a'.repeat(40), CODE)).toBeNull()
  })

  it('builds the deep link, normalising as it goes', () => {
    expect(telegramDeepLink('WsWeatherBot', 'ABC')).toBe(
      'https://t.me/WsWeatherBot?start=link_ABC',
    )
    expect(telegramDeepLink('@WsWeatherBot', 'ABC')).toBe(
      'https://t.me/WsWeatherBot?start=link_ABC',
    )
  })

  // configuredBotUsername is what both the card and the server action call, and
  // it had no test at all.
  it.each([
    ['@weather_station2_bot', 'weather_station2_bot'],
    ['weather_station2_bot', 'weather_station2_bot'],
    ['https://t.me/weather_station2_bot', 'weather_station2_bot'],
  ])('reads %j from the environment as %j', (configured, expected) => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = configured
    expect(configuredBotUsername()).toBe(expected)
    expect(botChatUrl()).toBe(`https://t.me/${expected}`)
  })

  it.each(['', '   ', 'my bot', 'abc', 'https://t.me/joinchat/AAA'])(
    'reports %j as unconfigured rather than building a dead link',
    (configured) => {
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = configured
      expect(configuredBotUsername()).toBeNull()
      expect(botChatUrl()).toBeNull()
    },
  )

  // The value this was actually configured with in production. `t.me/@name`
  // answers 302 to telegram.org — no bot, no /start, no error — so the code sat
  // untouched in the database until it expired, on both the link and the QR.
  it('handles the real configured value, @-prefixed', () => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = '@weather_station2_bot'
    expect(telegramDeepLink('@weather_station2_bot', 'ABC')).toBe(
      'https://t.me/weather_station2_bot?start=link_ABC',
    )
    expect(botChatUrl()).toBe('https://t.me/weather_station2_bot')
  })
})
