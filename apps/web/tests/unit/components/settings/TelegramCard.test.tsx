/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

const me = {
  data: {
    id: 'u1',
    clerkUserId: 'user_1',
    telegramId: null as number | null,
    createdAt: 't',
  },
  isLoading: false,
}
jest.mock('@/services/users/users.queries', () => ({
  useCurrentUserQuery: () => me,
  userKeys: { all: ['users'], current: ['users', 'current'] },
}))
const start = jest.fn<Promise<unknown>, []>()
const status = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/telegram.action', () => ({
  startTelegramLinkAction: () => start(),
  getTelegramLinkStatusAction: (i: unknown) => status(i),
  unlinkTelegramAction: jest.fn(),
}))
jest.mock('qrcode', () => ({
  toDataURL: async () => 'data:image/png;base64,QR',
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt: string }) => (
    <span data-testid="qr-image" aria-label={props.alt} />
  ),
}))

import { TelegramCard } from '@/components/settings/TelegramCard'

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  )

describe('TelegramCard', () => {
  it('starts linking, shows the deep link + QR, and polls status', async () => {
    start.mockResolvedValue({
      ok: true,
      data: {
        code: 'ABC',
        deepLink: 'https://t.me/Bot?start=link_ABC',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    })
    status.mockResolvedValue({ ok: true, data: { state: 'pending' } })
    const user = userEvent.setup()
    wrap(<TelegramCard testId="tg" />)
    expect(screen.getByTestId('tg-unlinked')).toBeInTheDocument()
    await user.click(screen.getByTestId('tg-link'))
    await waitFor(() =>
      expect(screen.getByTestId('tg-deeplink')).toHaveAttribute(
        'href',
        'https://t.me/Bot?start=link_ABC',
      ),
    )
    await waitFor(() =>
      expect(screen.getByTestId('qr-image')).toBeInTheDocument(),
    )
    await waitFor(() => expect(status).toHaveBeenCalledWith({ code: 'ABC' }))
    expect(screen.getByTestId('tg-state')).toHaveTextContent(
      'Waiting for Telegram',
    )
  })

  it('shows the linked state with an Unlink button', () => {
    me.data.telegramId = 987654821
    wrap(<TelegramCard testId="tg" />)
    expect(screen.getByTestId('tg-linked')).toHaveTextContent('tg · …4821')
    expect(screen.getByTestId('tg-unlink')).toBeInTheDocument()
    me.data.telegramId = null
  })
})
