import type { Participant } from '@/types/participant'
import { useRoomGameState } from '@/hooks/useRoomGameState'
import { api } from '@convex/_generated/api'
import { useMutation } from 'convex/react'
import { Moon, Sun, SunMoon } from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@repo/ui/components/tooltip'

interface RoomRolesPanelProps {
  roomId: string
  currentUserId: string
  participants: Participant[]
}

const ROLE_LABELS = {
  monarch: { emoji: '👑', label: 'Monarch' },
  initiative: { emoji: '⚔️', label: 'Initiative' },
  ring: { emoji: '💍', label: 'The Ring' },
  citysBlessing: { emoji: '✨', label: "City's Blessing" },
} as const

function nameFor(userId: string | null, participants: Participant[]): string {
  if (!userId) return '—'
  return participants.find((p) => p.id === userId)?.username ?? userId
}

export function RoomRolesPanel({ roomId, currentUserId, participants }: RoomRolesPanelProps) {
  const gameState = useRoomGameState(roomId)

  const claimMonarch = useMutation(api.gameState.claimMonarch)
  const claimInitiative = useMutation(api.gameState.claimInitiative)
  const claimRing = useMutation(api.gameState.claimRing)
  const toggleCitysBlessing = useMutation(api.gameState.toggleCitysBlessing)
  const clearRole = useMutation(api.gameState.clearRole)
  const setDayNight = useMutation(api.gameState.setDayNight)

  const dayNight = gameState?.dayNightState ?? null

  const hasBlessing = gameState?.citysBlessingUserIds.includes(currentUserId) ?? false

  return (
    <div className="space-y-1.5">
      {/* Day / Night cycle */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-text-muted">Day / Night</span>
        <div className="gap-1 flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDayNight({ roomId, state: 'day' })}
                className={`h-6 w-6 p-0 ${dayNight === 'day' ? 'text-yellow-400 bg-yellow-400/10' : 'text-text-muted hover:text-yellow-400'}`}
              >
                <Sun className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Day</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDayNight({ roomId, state: 'night' })}
                className={`h-6 w-6 p-0 ${dayNight === 'night' ? 'text-blue-400 bg-blue-400/10' : 'text-text-muted hover:text-blue-400'}`}
              >
                <Moon className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Night</TooltipContent>
          </Tooltip>
          {dayNight && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDayNight({ roomId, state: 'none' })}
                  className="h-6 w-6 p-0 text-text-muted hover:text-text-secondary"
                >
                  <SunMoon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear day/night</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Role rows */}
      <RoleRow
        emoji={ROLE_LABELS.monarch.emoji}
        label={ROLE_LABELS.monarch.label}
        holder={nameFor(gameState?.monarchUserId ?? null, participants)}
        isMe={gameState?.monarchUserId === currentUserId}
        onClaim={() => claimMonarch({ roomId })}
        onClear={() => clearRole({ roomId, role: 'monarch' })}
        assignable={participants}
        onAssign={(userId) => claimMonarch({ roomId, targetUserId: userId })}
        roomId={roomId}
      />
      <RoleRow
        emoji={ROLE_LABELS.initiative.emoji}
        label={ROLE_LABELS.initiative.label}
        holder={nameFor(gameState?.initiativeUserId ?? null, participants)}
        isMe={gameState?.initiativeUserId === currentUserId}
        onClaim={() => claimInitiative({ roomId })}
        onClear={() => clearRole({ roomId, role: 'initiative' })}
        assignable={participants}
        onAssign={(userId) => claimInitiative({ roomId, targetUserId: userId })}
        roomId={roomId}
      />
      <RoleRow
        emoji={ROLE_LABELS.ring.emoji}
        label={ROLE_LABELS.ring.label}
        holder={nameFor(gameState?.thRingBearerUserId ?? null, participants)}
        isMe={gameState?.thRingBearerUserId === currentUserId}
        onClaim={() => claimRing({ roomId })}
        onClear={() => clearRole({ roomId, role: 'ring' })}
        assignable={participants}
        onAssign={(userId) => claimRing({ roomId, targetUserId: userId })}
        roomId={roomId}
      />

      {/* City's Blessing — toggleable per-player, no "assign" */}
      <div className="flex items-center justify-between rounded-md px-1 py-0.5">
        <div className="gap-1.5 flex items-center">
          <span className="text-sm">{ROLE_LABELS.citysBlessing.emoji}</span>
          <span className="text-xs text-text-muted">{ROLE_LABELS.citysBlessing.label}</span>
          {(gameState?.citysBlessingUserIds.length ?? 0) > 0 && (
            <span className="text-xs text-text-secondary">
              ({gameState!.citysBlessingUserIds.map((id) => nameFor(id, participants)).join(', ')})
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleCitysBlessing({ roomId })}
          className={`h-6 px-2 text-xs ${
            hasBlessing
              ? 'text-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {hasBlessing ? 'Lose' : 'Gain'}
        </Button>
      </div>
    </div>
  )
}

interface RoleRowProps {
  emoji: string
  label: string
  holder: string
  isMe: boolean
  onClaim: () => void
  onClear: () => void
  assignable: Participant[]
  onAssign: (userId: string) => void
  roomId: string
}

function RoleRow({ emoji, label, holder, isMe, onClaim, onClear, assignable, onAssign }: RoleRowProps) {
  const hasHolder = holder !== '—'

  return (
    <div className="flex items-center justify-between rounded-md px-1 py-0.5">
      <div className="gap-1.5 flex min-w-0 items-center">
        <span className="text-sm">{emoji}</span>
        <span className="text-xs text-text-muted">{label}</span>
        {hasHolder && (
          <span className={`truncate text-xs ${isMe ? 'font-medium text-brand-muted-foreground' : 'text-text-secondary'}`}>
            {holder}
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 px-2 text-xs flex-shrink-0 ${
              isMe
                ? 'text-brand-muted-foreground bg-brand/10 hover:bg-brand/20'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {isMe ? 'Yours' : hasHolder ? 'Take' : 'Claim'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-surface-3 bg-surface-2">
          <DropdownMenuItem
            onClick={onClaim}
            className="focus:text-white text-text-secondary focus:bg-surface-3"
          >
            Take for myself
          </DropdownMenuItem>
          {assignable.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => onAssign(p.id)}
              className="focus:text-white text-text-secondary focus:bg-surface-3"
            >
              Give to {p.username}
            </DropdownMenuItem>
          ))}
          {hasHolder && (
            <DropdownMenuItem
              onClick={onClear}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              Clear
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
