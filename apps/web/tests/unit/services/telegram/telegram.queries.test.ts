import { ActionError } from '@/lib/actions/unwrap'
import { shouldPollLinkStatus } from '@/services/telegram/telegram.queries'

describe('shouldPollLinkStatus', () => {
  it('polls while the code is unclaimed and stops once it resolves', () => {
    expect(shouldPollLinkStatus('pending', null)).toBe(true)
    expect(shouldPollLinkStatus('linked', null)).toBe(false)
    expect(shouldPollLinkStatus('failed', null)).toBe(false)
    expect(shouldPollLinkStatus('expired', null)).toBe(false)
    expect(shouldPollLinkStatus(undefined, null)).toBe(false)
  })

  it('keeps polling through failures that can recover', () => {
    expect(shouldPollLinkStatus(undefined, new Error('network down'))).toBe(
      true,
    )
    expect(
      shouldPollLinkStatus(undefined, new ActionError('nope', 'UNKNOWN')),
    ).toBe(true)
  })

  // `retry: false` sends every failure down the error branch, so polling every
  // error forever meant an expired Clerk session hammered the server action
  // every three seconds in the background until the tab closed.
  it('gives up on failures that cannot resolve themselves', () => {
    expect(
      shouldPollLinkStatus(undefined, new ActionError('gone', 'NOT_FOUND')),
    ).toBe(false)
    expect(
      shouldPollLinkStatus(undefined, new ActionError('out', 'UNAUTHORIZED')),
    ).toBe(false)
  })
})
