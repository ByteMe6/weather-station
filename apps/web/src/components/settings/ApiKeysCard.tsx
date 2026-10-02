'use client'

import { useUser } from '@clerk/nextjs'
import type { ApiKeyExpiryDays, ApiKeyScope } from '@ws/shared'
import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_EXPIRY_DAYS,
  API_KEY_MAX_ACTIVE,
} from '@ws/shared'
import Link from 'next/link'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/CopyButton'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { ActionError } from '@/lib/actions/unwrap'
import type { ApiKeySummary } from '@/lib/api/keys/provider'
import { formatDateTime } from '@/lib/format'
import {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
} from '@/services/api-keys/api-keys.queries'

type ExpiryChoice = `${ApiKeyExpiryDays}` | 'never'
type KeyStatus = 'active' | 'revoked' | 'expired'

const SCOPE_OPTIONS: { value: ApiKeyScope; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'read_write', label: 'Read & write' },
]
const EXPIRY_OPTIONS: { value: ExpiryChoice; label: string }[] = [
  ...API_KEY_EXPIRY_DAYS.map((days) => ({
    value: `${days}` as ExpiryChoice,
    label: `${days} days`,
  })),
  { value: 'never', label: 'Never' },
]
const DEFAULT_EXPIRY: ExpiryChoice = `${API_KEY_DEFAULT_EXPIRY_DAYS}`
const STATUS_LABEL: Record<KeyStatus, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
}

const toExpiresInDays = (choice: ExpiryChoice): number | null =>
  choice === 'never' ? null : Number(choice)

const keyStatus = (key: ApiKeySummary, now: number): KeyStatus => {
  if (key.revokedAt) return 'revoked'
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return 'expired'
  return 'active'
}

const ApiKeyRow = ({
  apiKey,
  now,
  testId,
}: {
  apiKey: ApiKeySummary
  now: number
  testId: string
}): ReactElement => {
  const revoke = useRevokeApiKeyMutation()
  const { mutate } = revoke
  const [confirming, setConfirming] = useState(false)
  const status = useMemo(() => keyStatus(apiKey, now), [apiKey, now])
  const meta = useMemo(
    () =>
      [
        `Created ${formatDateTime(apiKey.createdAt)}`,
        `last used ${apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : 'never'}`,
        `expires ${apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'never'}`,
      ].join(' · '),
    [apiKey],
  )

  const askConfirm = useCallback(() => setConfirming(true), [])
  const cancel = useCallback(() => setConfirming(false), [])
  const confirm = useCallback(
    () => mutate({ keyId: apiKey.id }),
    [apiKey.id, mutate],
  )

  return (
    <li
      data-testid={testId}
      className="border-line flex flex-col gap-1 border-b py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid={`${testId}-name`} className="font-medium">
          {apiKey.name}
        </span>
        <Badge testId={`${testId}-scope`}>
          {apiKey.scope === 'read' ? 'Read' : 'Read & write'}
        </Badge>
        <Badge
          testId={`${testId}-status`}
          tone={status === 'active' ? 'neutral' : 'muted'}
        >
          {STATUS_LABEL[status]}
        </Badge>
        {apiKey.hint ? (
          <code
            data-testid={`${testId}-hint`}
            className="text-slate ml-auto font-mono text-xs"
          >
            {`…${apiKey.hint}`}
          </code>
        ) : null}
      </div>
      <p data-testid={`${testId}-meta`} className="text-slate text-xs">
        {meta}
      </p>
      {status === 'active' ? (
        <div className="flex gap-2">
          {confirming ? (
            <>
              <Button
                testId={`${testId}-confirm`}
                variant="danger"
                size="sm"
                loading={revoke.isPending}
                onClick={confirm}
              >
                Revoke now
              </Button>
              <Button
                testId={`${testId}-cancel`}
                variant="ghost"
                size="sm"
                onClick={cancel}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              testId={`${testId}-revoke`}
              variant="ghost"
              size="sm"
              onClick={askConfirm}
            >
              Revoke
            </Button>
          )}
        </div>
      ) : null}
      {revoke.error ? (
        <p data-testid={`${testId}-error`} className="text-danger text-xs">
          {revoke.error.message}
        </p>
      ) : null}
    </li>
  )
}

const ApiKeySecret = ({
  secret,
  testId,
  onDone,
}: {
  secret: string
  testId: string
  onDone: () => void
}): ReactElement => {
  const curl = useMemo(
    () =>
      `curl -H "Authorization: Bearer ${secret}" ${window.location.origin}/api/v1/stations`,
    [secret],
  )
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <code
          data-testid={`${testId}-value`}
          className="bg-paper-2 rounded-control flex-1 p-2 font-mono text-xs break-all select-all"
        >
          {secret}
        </code>
        <CopyButton
          testId={`${testId}-copy`}
          value={secret}
          label="Copy key"
          copiedLabel="Key copied"
        />
      </div>
      <p className="text-danger text-[13px] font-medium">
        Shown once. Store it now — it cannot be shown again, only revoked.
      </p>
      <div className="flex items-start gap-2">
        <code
          data-testid={`${testId}-curl`}
          className="bg-paper-2 rounded-control flex-1 p-2 font-mono text-xs break-all"
        >
          {curl}
        </code>
        <CopyButton
          testId={`${testId}-copy-curl`}
          value={curl}
          label="Copy"
          copiedLabel="Copied"
        />
      </div>
      <div className="flex justify-end">
        <Button testId={`${testId}-done`} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

export const ApiKeysCard = ({ testId }: { testId: string }): ReactElement => {
  const { isLoaded, isSignedIn } = useUser()
  const keys = useApiKeysQuery(!!isSignedIn)
  const create = useCreateApiKeyMutation()
  const { mutateAsync, reset, isPending } = create
  const { refetch } = keys
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiKeyScope>('read')
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [secret, setSecret] = useState<string | null>(null)

  // "Now" is the moment the list was fetched, not Date.now(): render must stay
  // pure, and an expiry that passes between fetches shows on the next one.
  const now = keys.dataUpdatedAt
  const activeCount = useMemo(
    () =>
      (keys.data ?? []).filter((k) => keyStatus(k, now) === 'active').length,
    [keys.data, now],
  )
  // A failed list must not read as "No keys yet" (and creation stays off: the
  // cap cannot be checked against a list we do not have).
  const loadFailed = keys.isError && !keys.data
  const atCap = activeCount >= API_KEY_MAX_ACTIVE

  const rows = useMemo(
    () =>
      (keys.data ?? []).map((apiKey) => (
        <ApiKeyRow
          key={apiKey.id}
          apiKey={apiKey}
          now={now}
          testId={`${testId}-key-${apiKey.id}`}
        />
      )),
    [keys.data, now, testId],
  )

  const openDialog = useCallback(() => {
    setName('')
    setScope('read')
    setExpiry(DEFAULT_EXPIRY)
    setErrors({})
    setSecret(null)
    reset()
    setOpen(true)
  }, [reset])
  const onOpenChange = useCallback(
    (next: boolean) => {
      // Closing mid-create would drop the secret the server is about to mint
      // (and reset() would re-enable Create for a parallel second key).
      if (!next && isPending) return
      setOpen(next)
      // The secret lives in this state and in the create mutation's result;
      // closing drops both (the mutation also has gcTime 0).
      if (!next) {
        setSecret(null)
        reset()
      }
    },
    [reset, isPending],
  )
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])
  const closeDialog = useCallback(() => onOpenChange(false), [onOpenChange])
  const onName = useCallback(
    (e: FormEvent<HTMLInputElement>) => setName(e.currentTarget.value),
    [],
  )
  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setErrors({})
      try {
        const created = await mutateAsync({
          name,
          scope,
          expiresInDays: toExpiresInDays(expiry),
        })
        setSecret(created.secret)
      } catch (err) {
        setErrors(
          err instanceof ActionError
            ? (err.fieldErrors ?? { form: err.message })
            : { form: 'Could not create the key. Try again.' },
        )
      }
    },
    [mutateAsync, expiry, name, scope],
  )

  if (!isLoaded || keys.isLoading) {
    return (
      <Card testId={testId}>
        <CardBody testId={`${testId}-body`}>
          <Skeleton testId={`${testId}-skeleton`} className="h-24 w-full" />
        </CardBody>
      </Card>
    )
  }

  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>API keys</CardTitle>
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        <p className="text-slate mb-2 text-sm">
          Read your stations from your own scripts (Grafana, Home Assistant,
          curl). See the{' '}
          <Link
            data-testid={`${testId}-docs`}
            href="/reference"
            className="underline"
          >
            API reference
          </Link>
          .
        </p>
        <p
          data-testid={`${testId}-warning`}
          className="text-slate mb-3 text-xs"
        >
          A key placed in a website&apos;s JavaScript is public. Use a Read key
          there, and remember it shows the address and coordinates of every
          station you can see — calling the API from your own server is safer.
        </p>
        {loadFailed ? (
          <div className="mb-3 flex items-center gap-3">
            <p
              data-testid={`${testId}-load-error`}
              className="text-danger text-sm"
            >
              {keys.error.message}
            </p>
            <Button
              testId={`${testId}-retry`}
              variant="ghost"
              size="sm"
              onClick={retry}
              loading={keys.isFetching}
            >
              Retry
            </Button>
          </div>
        ) : rows.length > 0 ? (
          <ul data-testid={`${testId}-list`} className="mb-3">
            {rows}
          </ul>
        ) : (
          <p
            data-testid={`${testId}-empty`}
            className="text-slate mb-3 text-sm"
          >
            No keys yet.
          </p>
        )}
        <Button
          testId={`${testId}-create`}
          size="sm"
          onClick={openDialog}
          disabled={atCap || loadFailed}
        >
          Create key
        </Button>
        {atCap ? (
          <p data-testid={`${testId}-cap`} className="text-slate mt-2 text-xs">
            You have {API_KEY_MAX_ACTIVE} active keys. Revoke one to create
            another.
          </p>
        ) : null}
      </CardBody>
      <Dialog
        testId={`${testId}-dialog`}
        open={open}
        onOpenChange={onOpenChange}
        title={secret ? 'Copy your API key' : 'Create API key'}
        description={
          secret
            ? "You won't see this key again."
            : 'Scripts send it as Authorization: Bearer <key>.'
        }
      >
        {secret ? (
          <ApiKeySecret
            secret={secret}
            testId={`${testId}-secret`}
            onDone={closeDialog}
          />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field
              testId={`${testId}-name`}
              label="Name"
              htmlFor="api-key-name"
              error={errors.name}
            >
              <Input
                testId={`${testId}-name-input`}
                id="api-key-name"
                value={name}
                onChange={onName}
                invalid={!!errors.name}
                autoComplete="off"
              />
            </Field>
            <Field
              testId={`${testId}-scope`}
              label="Access"
              htmlFor="api-key-scope"
              error={errors.scope}
            >
              <Select
                testId={`${testId}-scope-select`}
                id="api-key-scope"
                value={scope}
                onValueChange={setScope}
                options={SCOPE_OPTIONS}
                ariaLabel="Access"
              />
            </Field>
            <Field
              testId={`${testId}-expiry`}
              label="Expires"
              htmlFor="api-key-expiry"
              error={errors.expiresInDays}
            >
              <Select
                testId={`${testId}-expiry-select`}
                id="api-key-expiry"
                value={expiry}
                onValueChange={setExpiry}
                options={EXPIRY_OPTIONS}
                ariaLabel="Expires"
              />
            </Field>
            {errors.form ? (
              <p
                data-testid={`${testId}-form-error`}
                className="text-danger text-sm"
              >
                {errors.form}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button
                testId={`${testId}-submit`}
                type="submit"
                loading={create.isPending}
              >
                Create key
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </Card>
  )
}
