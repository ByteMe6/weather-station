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
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}))
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

// Shared module-level fixture: reset for every test, not only the happy path.
beforeEach(() => {
  jest.clearAllMocks()
  me.data.telegramId = null
})

const linkAndWait = async () => {
  const user = userEvent.setup()
  wrap(<TelegramCard testId="tg" />)
  await user.click(screen.getByTestId('tg-link'))
  await waitFor(() => expect(screen.getByTestId('tg-pending')).toBeVisible())
}

const PENDING = {
  ok: true,
  data: {
    code: 'ABC',
    deepLink: 'https://t.me/Bot?start=link_ABC',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  },
}

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

  // Mutation guards. Neither card-side behaviour was covered: reverting
  // `activeLink` to plain `pending`, or collapsing the terminal/retrying split
  // back to a blanket "retrying", left the whole suite green.

  it('stops showing the pending panel once the account reads as linked', async () => {
    start.mockResolvedValue(PENDING)
    status.mockResolvedValue({ ok: true, data: { state: 'pending' } })
    await linkAndWait()
    // The users row catching up is what ends the pending panel; keeping it
    // mounted left the status query enabled for the life of the tab.
    me.data.telegramId = 987654821
    wrap(<TelegramCard testId="tg2" />)
    expect(screen.queryByTestId('tg2-pending')).not.toBeInTheDocument()
    expect(screen.getByTestId('tg2-linked')).toBeInTheDocument()
  })

  it('says the link succeeded rather than "Waiting for Telegram"', async () => {
    start.mockResolvedValue(PENDING)
    status.mockResolvedValue({ ok: true, data: { state: 'linked' } })
    await linkAndWait()
    await waitFor(() =>
      expect(screen.getByTestId('tg-state')).toHaveTextContent('Linked'),
    )
    expect(screen.getByTestId('tg-state')).not.toHaveTextContent(
      'Waiting for Telegram',
    )
  })

  it('reports a terminal check failure as terminal, not as "retrying"', async () => {
    start.mockResolvedValue(PENDING)
    status.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Unknown link code',
    })
    await linkAndWait()
    await waitFor(() =>
      expect(screen.getByTestId('tg-state')).toHaveTextContent('Start again'),
    )
    expect(screen.getByTestId('tg-state')).not.toHaveTextContent('retrying')
  })

  it('keeps a delivered refusal on screen instead of a later transient error', async () => {
    start.mockResolvedValue(PENDING)
    status.mockResolvedValue({
      ok: true,
      data: { state: 'failed', reason: 'That Telegram account is taken' },
    })
    await linkAndWait()
    await waitFor(() =>
      expect(screen.getByTestId('tg-state')).toHaveTextContent(
        'That Telegram account is taken',
      ),
    )
  })
})
