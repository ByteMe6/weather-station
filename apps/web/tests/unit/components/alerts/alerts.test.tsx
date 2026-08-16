/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
const schedules = { data: [] as unknown[], isLoading: false }
const mutate = jest.fn()
jest.mock('@/services/schedules/schedules.queries', () => ({
  useSchedulesQuery: () => schedules,
  useCreateScheduleMutation: () => ({ mutateAsync: mutate, isPending: false }),
  useUpdateScheduleMutation: () => ({ mutateAsync: mutate, isPending: false }),
  useDeleteScheduleMutation: () => ({ mutateAsync: mutate, isPending: false }),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

import { AlertsView } from '@/components/alerts/AlertsView'
import { ScheduleDialog } from '@/components/alerts/ScheduleDialog'

describe('alerts', () => {
  it('asks to link Telegram when no telegramId', () => {
    render(<AlertsView testId="al" />)
    expect(screen.getByTestId('al-link-telegram')).toHaveTextContent(
      'Link Telegram',
    )
    expect(screen.getByTestId('al-link-telegram-action')).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('lists schedules with day pills when linked', () => {
    me.data.telegramId = 42
    schedules.data = [
      {
        id: 1,
        userId: 'u1',
        time: '07:30',
        timezone: 'Europe/Kyiv',
        days: [1, 2, 3, 4, 5],
        createdAt: 't',
      },
      {
        id: 2,
        userId: 'u1',
        time: '18:00',
        timezone: 'Europe/Kyiv',
        days: [6, 7],
        createdAt: 't',
      },
    ]
    render(<AlertsView testId="al" />)
    expect(screen.getByTestId('al-row-1')).toHaveTextContent('07:30')
    expect(screen.getByTestId('al-row-1-day-1')).toHaveAttribute(
      'data-on',
      'true',
    )
    expect(screen.getByTestId('al-row-2-day-1')).toHaveAttribute(
      'data-on',
      'false',
    )
    me.data.telegramId = null
    schedules.data = []
  })

  it('ScheduleDialog requires at least one day', async () => {
    const user = userEvent.setup()
    const onSubmit = jest.fn()
    render(
      <ScheduleDialog
        testId="sd"
        open
        onOpenChange={jest.fn()}
        initial={{ time: '07:30', timezone: 'UTC', days: [] }}
        onSubmit={onSubmit}
        pending={false}
      />,
    )
    await user.click(screen.getByTestId('sd-save'))
    expect(screen.getByTestId('sd-days-error')).toHaveTextContent(
      'Pick at least one day',
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
