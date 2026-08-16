'use client'

import { useClerk } from '@clerk/nextjs'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { ActionError } from '@/lib/actions/unwrap'
import { useDeleteAccountMutation } from '@/services/account/account.queries'

export const DeleteAccountCard = ({
  testId,
}: {
  testId: string
}): ReactElement => {
  const { signOut } = useClerk()
  const { toast } = useToast()
  const deleteAccount = useDeleteAccountMutation()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | undefined>()

  const openDialog = useCallback(() => setOpen(true), [])
  const onConfirmation = useCallback(
    (e: FormEvent<HTMLInputElement>) => setConfirmation(e.currentTarget.value),
    [],
  )
  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setError(undefined)
      try {
        await deleteAccount.mutateAsync({ confirmation })
      } catch (err) {
        setError(
          err instanceof ActionError
            ? (err.fieldErrors?.confirmation ?? err.message)
            : 'Could not delete your account. Try again.',
        )
        return
      }
      toast({ title: 'Account deleted', tone: 'success' })
      await signOut({ redirectUrl: '/sign-in' })
    },
    [confirmation, deleteAccount, signOut, toast],
  )

  return (
    <Card testId={testId} className="border-danger/40">
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>Delete account</CardTitle>
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        <p className="text-slate mb-3 text-sm">
          Removes your sign-in account (Clerk) together with your station links,
          alerts and Telegram link. Readings stay with the station, which
          becomes claimable again.
        </p>
        <Button
          testId={`${testId}-open`}
          variant="danger"
          size="sm"
          onClick={openDialog}
        >
          Delete account
        </Button>
      </CardBody>
      <Dialog
        testId={`${testId}-dialog`}
        open={open}
        onOpenChange={setOpen}
        title="Delete your account?"
        description="This cannot be undone. Type delete to confirm."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            testId={`${testId}-confirm`}
            label="Type delete"
            htmlFor="delete-confirm"
            error={error}
          >
            <Input
              testId={`${testId}-confirm-input`}
              id="delete-confirm"
              value={confirmation}
              onChange={onConfirmation}
              invalid={!!error}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end">
            <Button
              testId={`${testId}-submit`}
              type="submit"
              variant="danger"
              loading={deleteAccount.isPending}
              disabled={confirmation.trim().toLowerCase() !== 'delete'}
            >
              Delete everything
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  )
}
