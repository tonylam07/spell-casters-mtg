/**
 * TurnTracker — compact turn + storm counter panel for the game sidebar.
 *
 * Shows:
 * - Whose turn it is ("Your turn" / "[Name]'s turn")
 * - Turn N counter (read-only)
 * - Storm counter with + / − buttons (resets automatically on End Turn)
 */

import { useAuth } from '@/contexts/AuthContext'
import { usePresence } from '@/contexts/PresenceContext'
import { api } from '@convex/_generated/api'
import { useMutation as useConvexMutation, useQuery } from 'convex/react'
import { Minus, Plus, RotateCcw, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'

interface TurnTrackerProps {
  roomId: string
}

export function TurnTracker({ roomId }: TurnTrackerProps) {
  const { user } = useAuth()
  const { uniqueParticipants } = usePresence()

  const turnState = useQuery(api.gameEvents.getTurnState, { roomId })
  const advanceTurn = useConvexMutation(api.gameEvents.advanceTurn)
  const incrementStorm = useConvexMutation(api.gameEvents.incrementStorm)

  if (!turnState) return null

  const { currentTurnUserId, turnCount, stormCount } = turnState

  const isMyTurn = currentTurnUserId === user?.id
  const currentPlayer = uniqueParticipants.find(
    (p) => p.id === currentTurnUserId,
  )
  const turnLabel = isMyTurn
    ? 'Your turn'
    : currentPlayer
      ? `${currentPlayer.username}'s turn`
      : turnCount === 0
        ? 'Game not started'
        : 'Waiting…'

  const handleAdvanceTurn = async () => {
    try {
      await advanceTurn({ roomId })
    } catch (err) {
      console.error('[TurnTracker] advanceTurn failed:', err)
      toast.error('Failed to advance turn')
    }
  }

  const handleStormDelta = async (delta: number) => {
    try {
      await incrementStorm({ roomId, delta })
    } catch (err) {
      console.error('[TurnTracker] incrementStorm failed:', err)
      toast.error('Failed to update storm count')
    }
  }

  return (
    <Card className="gap-0 overflow-hidden border-surface-2 bg-surface-1">
      {/* Turn label + End Turn button */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-surface-2 bg-surface-0/50">
        <span
          className={`text-sm font-medium truncate ${isMyTurn ? 'text-brand' : 'text-text-secondary'}`}
        >
          {turnLabel}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAdvanceTurn}
          className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-text-primary flex-shrink-0"
          title="End turn"
        >
          <RotateCcw className="h-3 w-3" />
          End Turn
        </Button>
      </div>

      {/* Turn count + Storm counter */}
      <div className="px-3 py-2 flex items-center justify-between">
        {/* Turn N */}
        <div className="gap-1.5 flex items-center">
          <span className="text-xs text-text-muted">Turn</span>
          <span className="text-sm font-semibold tabular-nums text-text-primary">
            {turnCount}
          </span>
        </div>

        {/* Storm counter */}
        <div className="gap-1 flex items-center">
          <Zap className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-xs text-text-muted">Storm</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleStormDelta(-1)}
            disabled={stormCount === 0}
            className="h-5 w-5 p-0 text-text-muted hover:text-text-primary disabled:opacity-30"
            aria-label="Decrease storm count"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="min-w-[1.25rem] text-center text-sm font-semibold tabular-nums text-text-primary">
            {stormCount}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleStormDelta(1)}
            className="h-5 w-5 p-0 text-text-muted hover:text-text-primary"
            aria-label="Increase storm count"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
