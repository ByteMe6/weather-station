'use client'

import type { DeviceRole } from '@ws/shared'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { MemberAvatar } from './MemberAvatar'
import { memberHandle } from './memberHandle'
import { ROLE_OPTIONS_COMPACT as ROLE_OPTIONS } from './roleOptions'

import type { MemberProfiles } from '@/actions/devices.action'
import { springs } from '@/components/motion/variants'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import {
  useRemoveMemberMutation,
  useUpdateMemberRoleMutation,
} from '@/services/devices/devices.queries'
import type { DeviceMember } from '@/services/devices/devices.service'

interface MemberRowProps {
  member: DeviceMember
  profile: MemberProfiles[string] | null
  isSelf: boolean
  canManage: boolean
  onRoleChange: (userId: string, role: DeviceRole) => void
  onRemove: (member: DeviceMember) => void
  testId: string
}

const MemberRow = ({
  member,
  profile,
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
      <MemberAvatar testId={`${testId}-avatar`} profile={profile} />
      <span className="flex min-w-0 flex-col">
        <span
          data-testid={`${testId}-name`}
          className="truncate text-sm font-medium"
        >
          {memberDisplayName(member, profile)}
        </span>
        <span
          data-testid={`${testId}-handle`}
          className="text-slate font-mono text-[11px]"
        >
          {memberHandle(member, profile)}
        </span>
      </span>
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

/**
 * Name from Clerk when we have one, else the email — a real address beats the
 * "Member" placeholder. Only when Clerk gave us neither do we fall back to
 * saying what kind of account it is.
 */
export const memberDisplayName = (
  member: Pick<DeviceMember, 'clerkTail' | 'telegramTail'>,
  profile: MemberProfiles[string] | null,
): string => {
  if (profile?.name) return profile.name
  if (profile?.email) return profile.email
  if (member.telegramTail && !member.clerkTail) return 'Telegram user'
  return 'Member'
}

interface MembersListProps {
  testId: string
  deviceId: string
  members: DeviceMember[]
  /** Clerk display data keyed by users.id; undefined while loading, {} when none. */
  profiles: MemberProfiles | undefined
  viewerUserId: string | null
  canManage: boolean
}

export const MembersList = ({
  testId,
  deviceId,
  members,
  profiles,
  viewerUserId,
  canManage,
}: MembersListProps): ReactElement => {
  const { toast } = useToast()
  const updateRole = useUpdateMemberRoleMutation(deviceId)
  const removeMember = useRemoveMemberMutation(deviceId)
  const [pendingRemove, setPendingRemove] = useState<DeviceMember | null>(null)

  const onRoleChange = useCallback(
    async (userId: string, role: DeviceRole) => {
      try {
        await updateRole.mutateAsync({ userId, role })
      } catch (err) {
        toast({
          title: "Couldn't change the role",
          description: err instanceof Error ? err.message : undefined,
          tone: 'danger',
        })
        return
      }
      toast({ title: 'Role updated', tone: 'success' })
    },
    [updateRole, toast],
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
    const userId = pendingRemove.userId
    setPendingRemove(null)
    try {
      await removeMember.mutateAsync({ userId })
    } catch (err) {
      toast({
        title: "Couldn't remove access",
        description: err instanceof Error ? err.message : undefined,
        tone: 'danger',
      })
      return
    }
    toast({ title: 'Access removed', tone: 'success' })
  }, [pendingRemove, removeMember, toast])

  return (
    <>
      <ul data-testid={testId} className="flex flex-col">
        <AnimatePresence initial={false}>
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              testId={`${testId}-row-${m.userId}`}
              member={m}
              profile={profiles?.[m.userId] ?? null}
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
            ? `${memberDisplayName(pendingRemove, profiles?.[pendingRemove.userId] ?? null)} (${memberHandle(pendingRemove, profiles?.[pendingRemove.userId] ?? null)}) will no longer see this station.`
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
