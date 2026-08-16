'use client'

import { useUser } from '@clerk/nextjs'
import { useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { toDataURL } from 'qrcode'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  useStartTelegramLinkMutation,
  useTelegramLinkStatusQuery,
  useUnlinkTelegramMutation,
} from '@/services/telegram/telegram.queries'
import { useCurrentUserQuery, userKeys } from '@/services/users/users.queries'

interface PendingLink {
  code: string
  deepLink: string
  expiresAt: string
}

const maskTelegram = (id: number): string => `tg · …${String(id).slice(-4)}`

const useCountdown = (expiresAt: string | null): string => {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now())
      const m = Math.floor(ms / 60_000)
      const s = Math.floor((ms % 60_000) / 1000)
      setLabel(`${m}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])
  return label
}

export const TelegramCard = ({ testId }: { testId: string }): ReactElement => {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { isLoaded } = useUser()
  const me = useCurrentUserQuery()
  const startLink = useStartTelegramLinkMutation()
  const unlinkTelegram = useUnlinkTelegramMutation()
  const [pending, setPending] = useState<PendingLink | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const countdown = useCountdown(pending?.expiresAt ?? null)

  const status = useTelegramLinkStatusQuery(pending?.code ?? null)
  const state = status.data?.ok ? status.data.data.state : null
  const failReason = status.data?.ok ? status.data.data.reason : undefined

  // Once the bot consumed the code, refresh the users row; the linked state
  // is derived from `me.data.telegramId`, so no local state needs resetting here.
  useEffect(() => {
    if (state === 'linked') {
      toast({ title: 'Telegram linked', tone: 'success' })
      void queryClient.invalidateQueries({ queryKey: userKeys.current })
    }
  }, [state, toast, queryClient])

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    void toDataURL(pending.deepLink, { margin: 1, width: 160 }).then((url) => {
      if (!cancelled) setQr(url)
    })
    return () => {
      cancelled = true
    }
  }, [pending])

  const start = useCallback(async () => {
    try {
      setPending(await startLink.mutateAsync())
    } catch (err) {
      toast({
        title: "Couldn't start linking",
        description: err instanceof Error ? err.message : undefined,
        tone: 'danger',
      })
    }
  }, [startLink, toast])

  const cancelPending = useCallback(() => {
    setPending(null)
    setQr(null)
  }, [])

  const openUnlink = useCallback(() => setUnlinkOpen(true), [])
  const closeUnlink = useCallback((o: boolean) => setUnlinkOpen(o), [])
  const cancelUnlink = useCallback(() => setUnlinkOpen(false), [])
  const unlink = useCallback(async () => {
    setUnlinkOpen(false)
    try {
      await unlinkTelegram.mutateAsync()
    } catch (err) {
      toast({
        title: "Couldn't unlink",
        description: err instanceof Error ? err.message : undefined,
        tone: 'danger',
      })
      return
    }
    // Any earlier (consumed) code must not resurface as "pending".
    setPending(null)
    setQr(null)
    toast({ title: 'Telegram unlinked', tone: 'success' })
  }, [unlinkTelegram, toast])

  const linkedId = me.data?.telegramId ?? null
  const showPending = linkedId === null ? pending : null

  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>Telegram</CardTitle>
        {linkedId !== null ? (
          <Badge testId={`${testId}-linked-badge`} tone="live">
            linked
          </Badge>
        ) : null}
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        {!isLoaded || me.isLoading ? (
          <Skeleton testId={`${testId}-skeleton`} className="h-10 w-64" />
        ) : linkedId !== null ? (
          <div
            data-testid={`${testId}-linked`}
            className="flex flex-wrap items-center gap-3"
          >
            <p className="text-sm">
              Linked as{' '}
              <span className="font-mono">{maskTelegram(linkedId)}</span>. The
              bot recognises you without{' '}
              <span className="font-mono">/register</span>, and you can manage
              alerts here.
            </p>
            <Button
              testId={`${testId}-unlink`}
              variant="ghost"
              size="sm"
              onClick={openUnlink}
            >
              Unlink
            </Button>
          </div>
        ) : showPending ? (
          <div
            data-testid={`${testId}-pending`}
            className="flex flex-wrap items-center gap-5"
          >
            {qr ? (
              <Image
                src={qr}
                alt="QR code for the Telegram link"
                width={160}
                height={160}
                unoptimized
                className="rounded-control border-line border"
              />
            ) : (
              <Skeleton testId={`${testId}-qr-skeleton`} className="size-40" />
            )}
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Open Telegram and tap Start — or scan the code.
              </p>
              <a
                data-testid={`${testId}-deeplink`}
                href={showPending.deepLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-control bg-ink text-paper inline-flex h-10 w-fit items-center px-4 text-sm font-semibold"
              >
                Open in Telegram
              </a>
              <p
                data-testid={`${testId}-state`}
                className="text-slate text-[13px]"
              >
                {state === 'failed'
                  ? (failReason ??
                    'That Telegram account is linked to another user')
                  : state === 'expired'
                    ? 'Code expired — start again'
                    : `Waiting for Telegram… code expires in ${countdown}`}
              </p>
              <Button
                testId={`${testId}-cancel`}
                variant="ghost"
                size="sm"
                onClick={cancelPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            data-testid={`${testId}-unlinked`}
            className="flex flex-wrap items-center gap-3"
          >
            <p className="text-slate text-sm">
              Link your Telegram account to get alerts and manage them from
              here.
            </p>
            <Button
              testId={`${testId}-link`}
              size="sm"
              loading={startLink.isPending}
              onClick={start}
            >
              Link Telegram
            </Button>
          </div>
        )}
      </CardBody>
      <Dialog
        testId={`${testId}-unlink-dialog`}
        open={unlinkOpen}
        onOpenChange={closeUnlink}
        title="Unlink Telegram?"
        description="Alerts stop being manageable from the web until you link again; the bot's own registration keeps working."
      >
        <div className="flex justify-end gap-2">
          <Button
            testId={`${testId}-unlink-cancel`}
            variant="ghost"
            onClick={cancelUnlink}
          >
            Cancel
          </Button>
          <Button
            testId={`${testId}-unlink-confirm`}
            variant="danger"
            loading={unlinkTelegram.isPending}
            onClick={unlink}
          >
            Unlink
          </Button>
        </div>
      </Dialog>
    </Card>
  )
}
