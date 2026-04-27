import { useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePresence } from '@/contexts/PresenceContext'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { ArrowRight, Sword } from 'lucide-react'

import { Button } from '@repo/ui/components/button'

interface TurnTrackerProps {
  roomId: string
}

export function TurnTracker({ roomId }: TurnTrackerProps) {
  const { user } = useAuth()
  const { uniqueParticipants } = usePresence()
  const currentTurnUserId = useQuery(api.gameEvents.getRoomTurn, { roomId })
  const advanceTurn = useMutation(api.gameEvents.advanceTurn)

  const isMyTurn = !!user && currentTurnUserId === user.id

  const activeName = uniqueParticipants.find(
    (p) => p.id === currentTurnUserId,
  )?.username

  const handleEndTurn = useCallback(() => {
    void advanceTurn({ roomId })
  }, [advanceTurn, roomId])

  if (currentTurnUserId === undefined) return null // query loading

  // No turn started yet
  if (currentTurnUserId === null) {
    return (
      <div className="px-3 py-1.5 flex items-center justify-between rounded-lg border border-surface-2 bg-surface-0/50">
        <span className="text-xs text-text-muted">Turn tracker inactive</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-brand-muted-foreground hover:text-brand-foreground"
          onClick={handleEndTurn}
        >
          Start turns
        </Button>
      </div>
    )
  }

  return (
    <div
      className={`px-3 py-1.5 flex items-center justify-between rounded-lg border transition-colors ${
        isMyTurn
          ? 'border-brand/50 bg-brand/10'
          : 'border-surface-2 bg-surface-0/50'
      }`}
    >
      <div className="gap-2 flex items-center">
        <Sword
          className={`h-3.5 w-3.5 ${isMyTurn ? 'text-brand-muted-foreground' : 'text-text-muted'}`}
        />
        <span
          className={`text-xs font-medium ${isMyTurn ? 'text-brand-muted-foreground' : 'text-text-secondary'}`}
        >
          {isMyTurn ? 'Your turn' : `${activeName ?? '...'}'s turn`}
        </span>
      </div>
      <Button
        size="sm"
        variant={isMyTurn ? 'default' : 'ghost'}
        className={`h-6 px-2 text-xs gap-1 ${isMyTurn ? '' : 'text-text-muted hover:text-text-secondary'}`}
        onClick={handleEndTurn}
      >
        {isMyTurn ? 'End Turn' : 'Skip'}
        <ArrowRight className="h-3 w-3" />
      </Button>
    </div>
  )
}

/**
 * Returns the userId of whoever has the active turn, or null if no turn active.
 * Used by video tiles to show the active-turn glow ring.
 */
export function useTurnUserId(roomId: string): string | null {
  return useQuery(api.gameEvents.getRoomTurn, { roomId }) ?? null
}
