/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'

const chunk = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/readings.action', () => ({
  exportReadingsChunkAction: (i: unknown) => chunk(i),
}))
const download = jest.fn<void, unknown[]>()
jest.mock('@/components/export/download', () => ({
  triggerDownload: (...a: unknown[]) => download(...a),
}))

import { useCsvExport } from '@/components/export/useCsvExport'

describe('useCsvExport', () => {
  it('loops chunks until the cursor is null, then downloads', async () => {
    chunk
      .mockResolvedValueOnce({
        ok: true,
        data: {
          lines: ['h', 'a'],
          nextCursor: { timestamp: 't', id: 1 },
          includesHeader: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { lines: ['b'], nextCursor: null, includesHeader: false },
      })
    const { result } = renderHook(() => useCsvExport())
    await act(async () => {
      await result.current.start({
        deviceId: 'WS-1',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-02T00:00:00.000Z',
      })
    })
    expect(chunk).toHaveBeenCalledTimes(2)
    expect(download).toHaveBeenCalledWith(
      'weather_WS-1_2026-08-01_2026-08-02.csv',
      ['h\n', 'a\n', 'b\n'],
    )
    expect(result.current.progress).toEqual({
      rows: 2,
      done: true,
      error: null,
    })
  })
})
