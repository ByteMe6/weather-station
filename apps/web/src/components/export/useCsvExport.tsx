'use client'

import { useCallback, useRef, useState } from 'react'

import { triggerDownload } from './download'

import type { ExportCursor } from '@/actions/readings.action'
import { exportReadingsChunkAction } from '@/actions/readings.action'
import { exportFilename } from '@/lib/csv'

export interface ExportProgress {
  rows: number
  done: boolean
  error: string | null
}

export const useCsvExport = (): {
  start: (p: { deviceId: string; from: string; to: string }) => Promise<void>
  abort: () => void
  progress: ExportProgress
} => {
  const [progress, setProgress] = useState<ExportProgress>({
    rows: 0,
    done: false,
    error: null,
  })
  const aborted = useRef(false)

  const abort = useCallback(() => {
    aborted.current = true
  }, [])

  const start = useCallback(
    async ({
      deviceId,
      from,
      to,
    }: {
      deviceId: string
      from: string
      to: string
    }) => {
      aborted.current = false
      setProgress({ rows: 0, done: false, error: null })
      const parts: string[] = []
      let cursor: ExportCursor | null = null
      let rows = 0
      try {
        do {
          const res = await exportReadingsChunkAction({
            deviceId,
            from,
            to,
            cursor,
          })
          if (aborted.current) return
          if (!res.ok) {
            setProgress({ rows, done: false, error: res.message })
            return
          }
          for (const line of res.data.lines) parts.push(`${line}\n`)
          rows += res.data.lines.length - (res.data.includesHeader ? 1 : 0)
          cursor = res.data.nextCursor
          setProgress({ rows, done: false, error: null })
        } while (cursor)
      } catch (err) {
        // The action returns its failures, but the CALL can still reject: a
        // 500, a timeout, a deploy invalidating the action id, or going
        // offline mid-export. Without this the dialog spun forever.
        console.error('exportReadingsChunkAction rejected', err)
        setProgress({
          rows,
          done: false,
          error: 'Export failed — check your connection and try again.',
        })
        return
      }
      triggerDownload(exportFilename(deviceId, from, to), parts)
      setProgress({ rows, done: true, error: null })
    },
    [],
  )

  return { start, abort, progress }
}
