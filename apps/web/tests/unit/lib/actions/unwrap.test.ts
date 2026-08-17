import { ActionError, unwrapAction } from '@/lib/actions/unwrap'

describe('unwrapAction', () => {
  it('returns the payload of a successful action', () => {
    expect(unwrapAction({ ok: true, data: { id: 7 } })).toEqual({ id: 7 })
  })

  it('throws an ActionError carrying the code and field errors', () => {
    // TanStack needs a rejection for isError/onError to work at all, which is
    // why every hook goes through this rather than returning the union.
    try {
      unwrapAction({
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Check the fields',
        fieldErrors: { label: 'too long' },
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ActionError)
      const actionError = err as ActionError
      expect(actionError.code).toBe('INVALID_INPUT')
      expect(actionError.message).toBe('Check the fields')
      expect(actionError.fieldErrors).toEqual({ label: 'too long' })
    }
  })

  it('is an Error, so generic handlers can read .message', () => {
    expect(() =>
      unwrapAction({ ok: false, code: 'UNKNOWN', message: 'boom' }),
    ).toThrow('boom')
  })
})
