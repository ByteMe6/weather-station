import { actionError, actionOk } from '@/lib/actions/result'

describe('ActionResult helpers', () => {
  it('builds ok and error shapes', () => {
    expect(actionOk({ id: 1 })).toEqual({ ok: true, data: { id: 1 } })
    expect(
      actionError('DEVICE_NOT_FOUND', 'Unknown', { deviceId: 'Unknown' }),
    ).toEqual({
      ok: false,
      code: 'DEVICE_NOT_FOUND',
      message: 'Unknown',
      fieldErrors: { deviceId: 'Unknown' },
    })
    expect(actionError('X', 'y')).toEqual({
      ok: false,
      code: 'X',
      message: 'y',
    })
  })
})
