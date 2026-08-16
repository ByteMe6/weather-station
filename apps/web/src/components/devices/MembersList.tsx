'use client'

import { useQueryClient } from '@tanstack/react-query'
import type { DeviceRole } from '@ws/shared'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { maskIdentifier } from './maskIdentifier'

import {
  removeMemberAction,
  updateMemberRoleAction,
} from '@/actions/devices.action'
import { springs } from '@/components/motion/variants'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { deviceKeys } from '@/services/devices/devices.queries'
import type { DeviceMember } from '@/services/devices/devices.service'

const ROLE_OPTIONS: { value: DeviceRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

interface MemberRowProps {
  member: DeviceMember
  isSelf: boolean
  canManage: boolean
  onRoleChange: (userId: string, role: DeviceRole) => void
  onRemove: (member: DeviceMember) => void
  testId: string
}

const MemberRow = ({
  member,
  isSelf,
  canManage,
  onRoleChange,
  onRemove,
  testId,
}: MemberRowProps): ReactElement => {
  const changeRole = useCallback(
    (role: DeviceRole) => onRoleChange(member.userId, role),
    [member.userId, onRoleChange],
  )
  const remove = useCallback(() => onRemove(member), [member, onRemove])
  return (
    <motion.li
      data-testid={testId}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={springs.default}
      className="border-line flex items-center gap-3 border-b py-3 last:border-b-0"
    >
      <span className="font-mono text-sm">{maskIdentifier(member)}</span>
      {isSelf ? <Badge testId={`${testId}-you`}>you</Badge> : null}
      <span className="flex-1" />
      {canManage ? (
        <Select<DeviceRole>
          testId={`${testId}-role`}
          ariaLabel="Role"
          value={member.role}
          onValueChange={changeRole}
          options={ROLE_OPTIONS}
        />
      ) : (
        <Badge testId={`${testId}-role-badge`}>{member.role}</Badge>
      )}
      {canManage ? (
        <Button
          testId={`${testId}-remove`}
          variant="ghost"
          size="sm"
          onClick={remove}
        >
          Remove
        </Button>
      ) : null}
    </motion.li>
  )
}

interface MembersListProps {
  testId: string
  deviceId: string
  members: DeviceMember[]
  viewerUserId: string | null
  canManage: boolean
}

export const MembersList = ({
  testId,
  deviceId,
  members,
  viewerUserId,
  canManage,
}: MembersListProps): ReactElement => {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [pendingRemove, setPendingRemove] = useState<DeviceMember | null>(null)

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: deviceKeys.members(deviceId),
    })
    await queryClient.invalidateQueries({ queryKey: deviceKeys.mine })
  }, [deviceId, queryClient])

  const onRoleChange = useCallback(
    async (userId: string, role: DeviceRole) => {
      const res = await updateMemberRoleAction({ deviceId, userId, role })
      if (!res.ok) {
        toast({
          title: "Couldn't change the role",
          description: res.message,
          tone: 'danger',
        })
        return
      }
      toast({ title: 'Role updated', tone: 'success' })
      await refresh()
    },
    [deviceId, refresh, toast],
  )

  const askRemove = useCallback(
    (member: DeviceMember) => setPendingRemove(member),
    [],
  )
  const closeRemove = useCallback((open: boolean) => {
    if (!open) setPendingRemove(null)
  }, [])
  const cancelRemove = useCallback(() => setPendingRemove(null), [])
  const confirmRemove = useCallback(async () => {
    if (!pendingRemove) return
    const res = await removeMemberAction({
      deviceId,
      userId: pendingRemove.userId,
    })
    setPendingRemove(null)
    if (!res.ok) {
      toast({
        title: "Couldn't remove access",
        description: res.message,
        tone: 'danger',
      })
      return
    }
    toast({ title: 'Access removed', tone: 'success' })
    await refresh()
  }, [deviceId, pendingRemove, refresh, toast])

  return (
    <>
      <ul data-testid={testId} className="flex flex-col">
        <AnimatePresence initial={false}>
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              testId={`${testId}-row-${m.userId}`}
              member={m}
              isSelf={m.userId === viewerUserId}
              canManage={canManage}
              onRoleChange={onRoleChange}
              onRemove={askRemove}
            />
          ))}
        </AnimatePresence>
      </ul>
      <Dialog
        testId={`${testId}-remove-dialog`}
        open={pendingRemove !== null}
        onOpenChange={closeRemove}
        title="Remove access?"
        description={
          pendingRemove
            ? `${maskIdentifier(pendingRemove)} will no longer see this station.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button
            testId={`${testId}-remove-cancel`}
            variant="ghost"
            onClick={cancelRemove}
          >
            Cancel
          </Button>
          <Button
            testId={`${testId}-remove-confirm`}
            variant="danger"
            onClick={confirmRemove}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </>
  )
}
