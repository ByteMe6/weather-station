/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import { ApiKeysCard } from '@/components/settings/ApiKeysCard'
import type { ApiKeySummary } from '@/lib/api/keys/provider'

const clerk = { isLoaded: true, isSignedIn: true }
jest.mock('@clerk/nextjs', () => ({ useUser: () => clerk }))
const list = jest.fn<Promise<unknown>, []>()
const create = jest.fn<Promise<unknown>, [unknown]>()
const revoke = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/api-keys.action', () => ({
  listApiKeysAction: () => list(),
  createApiKeyAction: (i: unknown) => create(i),
  revokeApiKeyAction: (i: unknown) => revoke(i),
}))

const key = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: 'k1',
  name: 'Grafana',
  scope: 'read',
  hint: 'a9Xk',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...over,
})

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  )

beforeEach(() => {
  jest.clearAllMocks()
  clerk.isLoaded = true
  list.mockResolvedValue({ ok: true, data: [key()] })
})

describe('ApiKeysCard', () => {
  it('shows a skeleton until Clerk has loaded', () => {
    clerk.isLoaded = false
    wrap(<ApiKeysCard testId="keys" />)
    expect(screen.getByTestId('keys-skeleton')).toBeInTheDocument()
  })

  it('lists keys by name and hint, never a full secret', async () => {
    list.mockResolvedValue({
      ok: true,
      data: [
        key(),
        key({ id: 'k2', name: 'Old', revokedAt: '2026-09-02T00:00:00Z' }),
      ],
    })
    wrap(<ApiKeysCard testId="keys" />)
    expect(await screen.findByText('Grafana')).toBeInTheDocument()
    expect(screen.getByTestId('keys-key-k1-hint')).toHaveTextContent('…a9Xk')
    expect(screen.getByTestId('keys-key-k2-status')).toHaveTextContent(
      'Revoked',
    )
  })

  it('creates a key with the defaults and reveals the secret once', async () => {
    create.mockResolvedValue({
      ok: true,
      data: { key: key({ id: 'k3' }), secret: 'wsk_live_SECRET' },
    })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-create'))
    await userEvent.type(
      screen.getByTestId('keys-name-input'),
      'Home Assistant',
    )
    await userEvent.click(screen.getByTestId('keys-submit'))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Home Assistant',
        scope: 'read',
        expiresInDays: 90,
      }),
    )
    expect(await screen.findByTestId('keys-secret-value')).toHaveTextContent(
      'wsk_live_SECRET',
    )
  })

  it('shows field errors from the action', async () => {
    create.mockResolvedValue({
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Check the highlighted fields',
      fieldErrors: { name: 'Give the key a name' },
    })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-create'))
    await userEvent.click(screen.getByTestId('keys-submit'))
    expect(await screen.findByText('Give the key a name')).toBeInTheDocument()
  })

  it('disables creation at the active-key cap', async () => {
    list.mockResolvedValue({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => key({ id: `k${i}` })),
    })
    wrap(<ApiKeysCard testId="keys" />)
    await waitFor(() =>
      expect(screen.getByTestId('keys-create')).toBeDisabled(),
    )
  })

  it('revokes after a confirmation click', async () => {
    revoke.mockResolvedValue({ ok: true, data: null })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-key-k1-revoke'))
    expect(revoke).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('keys-key-k1-confirm'))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ keyId: 'k1' }))
  })
  it('shows a skeleton while the key list is loading', () => {
    list.mockReturnValue(new Promise(() => {}))
    wrap(<ApiKeysCard testId="keys" />)
    expect(screen.getByTestId('keys-skeleton')).toBeInTheDocument()
  })

  it('shows a load error with Retry, not the empty state', async () => {
    list.mockResolvedValueOnce({
      ok: false,
      code: 'UNKNOWN',
      message: 'Something went wrong. Try again.',
    })
    wrap(<ApiKeysCard testId="keys" />)
    expect(await screen.findByTestId('keys-load-error')).toHaveTextContent(
      'Something went wrong. Try again.',
    )
    expect(screen.queryByTestId('keys-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('keys-create')).toBeDisabled()
    await userEvent.click(screen.getByTestId('keys-retry'))
    expect(await screen.findByText('Grafana')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('marks a past expiry as Expired and offers no Revoke on it', async () => {
    list.mockResolvedValue({
      ok: true,
      data: [
        key({ id: 'e1', expiresAt: '2020-01-01T00:00:00.000Z' }),
        key({ id: 'r1', revokedAt: '2026-09-02T00:00:00Z' }),
      ],
    })
    wrap(<ApiKeysCard testId="keys" />)
    expect(await screen.findByTestId('keys-key-e1-status')).toHaveTextContent(
      'Expired',
    )
    expect(screen.queryByTestId('keys-key-e1-revoke')).not.toBeInTheDocument()
    expect(screen.queryByTestId('keys-key-r1-revoke')).not.toBeInTheDocument()
  })

  it('renders no hint element when the provider has none', async () => {
    list.mockResolvedValue({ ok: true, data: [key({ hint: null })] })
    wrap(<ApiKeysCard testId="keys" />)
    await screen.findByText('Grafana')
    expect(screen.queryByTestId('keys-key-k1-hint')).not.toBeInTheDocument()
  })

  it('refetches the list when a revoke fails with NOT_FOUND', async () => {
    revoke.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      message: 'That key no longer exists',
    })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-key-k1-revoke'))
    await userEvent.click(screen.getByTestId('keys-key-k1-confirm'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('keys-key-k1-error')).toHaveTextContent(
      'That key no longer exists',
    )
  })

  it('does not show the secret again after close and reopen', async () => {
    create.mockResolvedValue({
      ok: true,
      data: { key: key({ id: 'k3' }), secret: 'wsk_live_SECRET' },
    })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-create'))
    await userEvent.type(screen.getByTestId('keys-name-input'), 'X')
    await userEvent.click(screen.getByTestId('keys-submit'))
    await screen.findByTestId('keys-secret-value')
    await userEvent.click(screen.getByTestId('keys-secret-done'))
    await waitFor(() =>
      expect(screen.queryByTestId('keys-secret-value')).not.toBeInTheDocument(),
    )
    await userEvent.click(screen.getByTestId('keys-create'))
    expect(await screen.findByTestId('keys-name-input')).toBeInTheDocument()
    expect(screen.queryByText('wsk_live_SECRET')).not.toBeInTheDocument()
  })

  it('explains the cap when at the active-key limit', async () => {
    list.mockResolvedValue({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => key({ id: `k${i}` })),
    })
    wrap(<ApiKeysCard testId="keys" />)
    expect(await screen.findByTestId('keys-cap')).toHaveTextContent(
      'You have 10 active keys. Revoke one to create another.',
    )
  })
  it('keeps the dialog open while a create is in flight', async () => {
    create.mockReturnValue(new Promise(() => {}))
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-create'))
    await userEvent.type(screen.getByTestId('keys-name-input'), 'X')
    await userEvent.click(screen.getByTestId('keys-submit'))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('keys-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('keys-submit')).toBeDisabled()
  })
})
