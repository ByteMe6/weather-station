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

  it('gives up on the one failure that cannot resolve itself', () => {
    expect(
      shouldPollLinkStatus(undefined, new ActionError('gone', 'NOT_FOUND')),
    ).toBe(false)
  })

  // Clerk rotates its session cookie, and resolveCurrentUserId returns null
  // while the users row is briefly absent — both surface as UNAUTHORIZED and
  // both succeed on the next tick, so treating it as terminal killed polls
  // that were about to work.
  it('keeps polling through UNAUTHORIZED, which resolves itself', () => {
    expect(
      shouldPollLinkStatus(undefined, new ActionError('out', 'UNAUTHORIZED')),
    ).toBe(true)
  })

  // Reading the error first re-armed the poll on an already-settled code: a
  // focus refetch of a linked code that failed left data.state === 'linked'
  // *and* an error, and polling restarted every 3s for the life of the tab.
  it('stays stopped when a settled code hits a transient error', () => {
    expect(shouldPollLinkStatus('linked', new Error('offline'))).toBe(false)
    expect(shouldPollLinkStatus('expired', new Error('offline'))).toBe(false)
  })

  // The expiry backstop used to judge a server-minted deadline with the
  // browser's clock, and could only ever cancel the timer — never produce the
  // 'expired' state — so a skewed client stopped watching a live code and a
  // correct one showed "Waiting… 0:00" instead of "Code expired". The server
  // decides expiry now; this bounds the error case by consecutive failures.
  it('keeps polling through failures until the ceiling, then stops', () => {
    const err = new Error('supabase down')
    expect(shouldPollLinkStatus(undefined, err, 0)).toBe(true)
    expect(shouldPollLinkStatus(undefined, err, 19)).toBe(true)
    expect(shouldPollLinkStatus(undefined, err, 20)).toBe(false)
    expect(shouldPollLinkStatus(undefined, err, 500)).toBe(false)
  })

  it('never bounds a healthy pending poll by the failure ceiling', () => {
    expect(shouldPollLinkStatus('pending', null, 0)).toBe(true)
    expect(shouldPollLinkStatus('pending', null, 999)).toBe(true)
  })
})
