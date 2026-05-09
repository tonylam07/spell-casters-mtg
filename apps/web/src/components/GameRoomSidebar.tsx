import type { CardHistoryEntry } from '@/types/card-query'
import type { Participant } from '@/types/participant'
import {
  Activity,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useCardQueryContext } from '@/contexts/CardQueryContext'
import { useCommanderDamageDialog } from '@/contexts/CommanderDamageDialogContext'
import { usePresence } from '@/contexts/PresenceContext'
import { api } from '@convex/_generated/api'
import { useQuery } from 'convex/react'
import { BookOpen, Heart, History, PanelLeft, Trash2 } from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@repo/ui/components/sheet'
import { Skeleton } from '@repo/ui/components/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@repo/ui/components/tooltip'

import { useDeck } from '@/hooks/useDeck'
import { CardPreview } from './CardPreview'
import { DeckImportDialog } from './DeckImportDialog'
import { DeckPanel } from './DeckPanel'
import { GameStatsPanel } from './GameStatsPanel'
import { PlayerList } from './PlayerList'
import { TurnTracker } from './TurnTracker'

/**
 * Shared sidebar card component with header and content
 */
export function SidebarCard({
  icon: Icon,
  title,
  count,
  children,
  maxHeight,
  fillRemaining,
  onScrollToTop,
  scrollTrigger,
  headerAction,
  countTestId,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count: string | number
  children: React.ReactNode
  maxHeight?: string
  /** When true, card grows to fill remaining flex space and content scrolls inside */
  fillRemaining?: boolean
  onScrollToTop?: boolean
  scrollTrigger?: number
  headerAction?: React.ReactNode
  countTestId?: string
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevScrollTriggerRef = useRef(scrollTrigger ?? 0)

  // Scroll to top when trigger changes (e.g., new item added)
  useEffect(() => {
    if (
      onScrollToTop &&
      scrollTrigger !== undefined &&
      scrollTrigger > prevScrollTriggerRef.current &&
      scrollContainerRef.current
    ) {
      scrollContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }
    if (scrollTrigger !== undefined) {
      prevScrollTriggerRef.current = scrollTrigger
    }
  }, [scrollTrigger, onScrollToTop])

  const contentClassName = fillRemaining
    ? 'min-h-0 flex-1 overflow-y-auto'
    : maxHeight
      ? `min-h-0 ${maxHeight} overflow-y-auto`
      : ''

  return (
    <Card
      className={`gap-0 overflow-hidden border-surface-2 bg-surface-1 ${fillRemaining ? 'min-h-0 flex max-h-full flex-col' : ''}`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-surface-2 bg-surface-0/50">
        <div className="gap-2 flex items-center">
          <Icon className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-medium text-text-secondary">
            {title}
          </span>
        </div>
        <div className="gap-2 flex items-center">
          <span className="text-xs text-text-muted" data-testid={countTestId}>
            {count}
          </span>
          {headerAction}
        </div>
      </div>
      <div ref={scrollContainerRef} className={contentClassName}>
        {children}
      </div>
    </Card>
  )
}

/**
 * Compact card history list component
 */
function CardHistoryList({
  history,
  onSelect,
  selectedCardId,
  onClear,
  onRemove,
}: {
  history: CardHistoryEntry[]
  onSelect: (entry: CardHistoryEntry) => void
  selectedCardId: string | null
  onClear: () => void
  onRemove: (entry: CardHistoryEntry) => void
}) {
  const hasHistory = history.length > 0

  return (
    <SidebarCard
      icon={History}
      title="Recent Cards"
      count={`(${history.length})`}
      fillRemaining
      onScrollToTop
      scrollTrigger={history.length}
      headerAction={
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={!hasHistory}
          className="h-5 w-5 p-0 text-text-muted hover:text-destructive disabled:cursor-not-allowed disabled:text-text-muted/50"
          title="Clear history"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      }
    >
      {history.map((entry) => {
        const isSelected = selectedCardId === entry.id
        return (
          <div
            key={`${entry.id}-${entry.timestamp}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(entry)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(entry)
              }
            }}
            className={`group gap-2 flex w-full items-center border-l-2 transition-colors ${
              isSelected
                ? 'cursor-default border-brand bg-surface-2'
                : 'cursor-pointer border-transparent hover:bg-surface-2'
            }`}
            aria-pressed={isSelected}
          >
            <div className="min-w-0 gap-2 px-3 py-2 flex flex-1 items-center text-left">
              {entry.image_url && (
                <img
                  src={entry.image_url}
                  alt=""
                  className="h-8 w-6 rounded flex-shrink-0 object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <Tooltip delayDuration={700}>
                  <TooltipTrigger asChild>
                    <span className="text-sm block truncate text-text-primary">
                      {entry.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{entry.name}</p>
                  </TooltipContent>
                </Tooltip>
                <div className="text-xs text-text-muted uppercase">
                  {entry.set}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onRemove(entry)
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-8 w-8 p-0 flex-shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
              title="Remove from list"
              aria-label={`Remove ${entry.name} from list`}
              data-testid={`recent-card-remove-${entry.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      })}
    </SidebarCard>
  )
}

/**
 * Life history list — shows the last 30 life change events for the room
 */
function LifeHistoryList({ roomId }: { roomId: string }) {
  const events = useQuery(api.gameEvents.getLifeHistory, { roomId })

  return (
    <SidebarCard
      icon={Heart}
      title="Life History"
      count={`(${events?.length ?? 0})`}
      maxHeight="max-h-48"
    >
      {!events || events.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-text-muted">
          No life changes yet
        </div>
      ) : (
        events.map((event: { _id: string; createdAt: number; payload: unknown }) => {
          const p = event.payload as {
            username: string
            delta: number
            newTotal: number
          }
          const isGain = p.delta > 0
          const deltaLabel = isGain ? `+${p.delta}` : `${p.delta}`
          const ts = new Date(event.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
          return (
            <div
              key={event._id}
              className="gap-2 px-3 py-1.5 flex items-center border-b border-surface-2/50 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                {p.username}
              </span>
              <span
                className={`text-xs font-medium tabular-nums ${isGain ? 'text-green-400' : 'text-red-400'}`}
              >
                {deltaLabel}
              </span>
              <span className="text-xs text-text-muted tabular-nums">
                → {p.newTotal}
              </span>
              <span className="text-xs text-text-muted/60 tabular-nums">
                {ts}
              </span>
            </div>
          )
        })
      )}
    </SidebarCard>
  )
}

/**
 * Threshold for considering a player "online" (15 seconds)
 * If lastSeenAt is older than this, they're shown as disconnected.
 * This is shorter than the 30-second presence threshold that removes them from the list entirely.
 */
const ONLINE_THRESHOLD_MS = 15_000

interface GameRoomSidebarProps {
  roomId: string
  userId: string
  playerName: string
  isLobbyOwner: boolean
  ownerId: string | null
  onKickPlayer: (playerId: string) => void
  onBanPlayer: (playerId: string) => void
  mutedPlayers: Set<string>
  onToggleMutePlayer: (playerId: string) => void
  /** Controlled open state for the commanders panel */
  commandersPanelOpen: boolean
  /** Called when the commanders panel should open or close */
  onCommandersPanelOpenChange: (open: boolean) => void
  /** Called when user wants to copy the shareable game link */
  onCopyShareLink: () => void
  /** Called when user wants to reset game state (life, poison, commanders) */
  onResetGame?: () => void
}

function SidebarContent({
  roomId,
  playerName,
  isLobbyOwner,
  ownerId,
  onKickPlayer,
  onBanPlayer,
  mutedPlayers,
  onToggleMutePlayer,
  commandersPanelOpen: panelOpen,
  onCommandersPanelOpenChange: setPanelOpen,
  onCopyShareLink,
  onResetGame,
}: GameRoomSidebarProps) {
  // Get game room participants from context (already deduplicated)
  const { uniqueParticipants, participants, roomSeatCount, setRoomSeatCount } =
    usePresence()
  const { user } = useAuth()
  const commanderDamageDialog = useCommanderDamageDialog()
  const {
    state,
    history,
    setResultWithoutHistory,
    clearResult,
    clearHistory,
    removeFromHistory,
  } = useCardQueryContext()

  const { deck, importDeck, moveCard, drawCard, shuffle, mulligan, deleteDeck } =
    useDeck(roomId, user?.id)
  const [deckImportOpen, setDeckImportOpen] = useState(false)

  // Determine the currently selected card ID for highlighting
  const selectedCardIdForHighlight = useMemo(() => {
    // Prefer state.result, fallback to history[0]
    const firstHistoryEntry = history[0]
    const displayResult =
      state.result ??
      (firstHistoryEntry && (state.status !== 'idle' || state.result != null)
        ? {
            name: firstHistoryEntry.name,
            set: firstHistoryEntry.set,
          }
        : null)

    if (!displayResult) return null

    // Match by name:set (same format as history entry id)
    return `${displayResult.name}:${displayResult.set}`
  }, [state.result, state.status, history])

  // Handler to re-select a history entry (doesn't add to history)
  const handleHistorySelect = useCallback(
    (entry: CardHistoryEntry) => {
      setResultWithoutHistory({
        name: entry.name,
        set: entry.set,
        score: 1.0, // Re-selection = full confidence
        scryfall_uri: entry.scryfall_uri,
        image_url: entry.image_url,
        card_url: entry.card_url,
      })
    },
    [setResultWithoutHistory],
  )

  // Current time state for computing online status (updates every 5 seconds)
  const [now, setNow] = useState(() => Date.now())

  // Update current time periodically to re-evaluate online status
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 5_000) // Check every 5 seconds

    return () => clearInterval(interval)
  }, [])

  // Compute players with online status based on lastSeenAt
  const playersWithStatus = useMemo(() => {
    return uniqueParticipants.map((participant) => ({
      id: participant.id,
      name: participant.username,
      isOnline: now - participant.lastSeenAt < ONLINE_THRESHOLD_MS,
    }))
  }, [uniqueParticipants, now])

  // Find current user participant
  const currentUser = useMemo<Participant | null>(() => {
    if (!user) return null
    return uniqueParticipants.find((p) => p.id === user.id) ?? null
  }, [uniqueParticipants, user])

  // Handler to close panel - use startTransition for smooth slide-out animation
  const handleClosePanel = useCallback(() => {
    startTransition(() => {
      setPanelOpen(false)
    })
  }, [setPanelOpen])

  // Handler to change seat count
  const handleChangeSeatCount = useCallback(
    (delta: number) => {
      const newCount = Math.max(
        uniqueParticipants.length,
        Math.min(4, roomSeatCount + delta),
      )
      if (newCount !== roomSeatCount) {
        setRoomSeatCount(newCount).catch((err) => {
          console.error('[GameRoomSidebar] Failed to set seat count:', err)
        })
      }
    },
    [roomSeatCount, uniqueParticipants.length, setRoomSeatCount],
  )

  const ownSeatCount = useMemo(
    () => participants.filter((p) => p.id === user?.id).length,
    [participants, user?.id],
  )

  const sidebarContent = (
    <>
      <div className="flex-shrink-0">
        <TurnTracker roomId={roomId} />
      </div>
      <div className="flex-shrink-0">
        <PlayerList
          players={playersWithStatus}
          isLobbyOwner={isLobbyOwner}
          localPlayerName={playerName}
          onKickPlayer={onKickPlayer}
          onBanPlayer={onBanPlayer}
          ownerId={ownerId ?? undefined}
          mutedPlayers={mutedPlayers}
          onToggleMutePlayer={onToggleMutePlayer}
          currentUserId={user?.id ?? undefined}
          onOpenCommanderDamage={commanderDamageDialog?.setOpenForPlayerId}
          seatCount={roomSeatCount}
          onChangeSeatCount={isLobbyOwner ? handleChangeSeatCount : undefined}
          onCopyShareLink={onCopyShareLink}
          onResetGame={onResetGame}
          roomId={roomId}
          ownSeatCount={ownSeatCount}
        />
      </div>
      {/* Deck Panel */}
      <div className="flex-shrink-0">
        {deck ? (
          <DeckPanel
            deck={deck}
            onMoveCard={moveCard}
            onDraw={drawCard}
            onShuffle={shuffle}
            onMulligan={mulligan}
            onDelete={deleteDeck}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeckImportOpen(true)}
            className="w-full gap-2 border-surface-2 text-text-muted hover:text-white"
          >
            <BookOpen className="h-4 w-4" />
            Load Deck
          </Button>
        )}
      </div>
      <div className="flex-shrink-0">
        <CardPreview onClose={clearResult} />
      </div>
      <div className="min-h-0 flex flex-1 flex-col">
        <CardHistoryList
          history={history}
          onSelect={handleHistorySelect}
          selectedCardId={selectedCardIdForHighlight}
          onClear={clearHistory}
          onRemove={removeFromHistory}
        />
      </div>
      <div className="flex-shrink-0">
        <LifeHistoryList roomId={roomId} />
      </div>
      <DeckImportDialog
        open={deckImportOpen}
        onOpenChange={setDeckImportOpen}
        onImport={importDeck}
      />
    </>
  )

  return (
    <>
      {/* Desktop sidebar (>= md) */}
      <div className="w-64 gap-4 md:flex hidden h-full flex-shrink-0 flex-col">
        {sidebarContent}
      </div>

      {/* Mobile drawer trigger + Sheet (< md). Floats top-left over the
          video grid so users can open the player list / card history. */}
      <div className="md:hidden left-3 top-20 absolute z-30">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-10 w-10 backdrop-blur-sm shadow-lg border-surface-3 bg-surface-1/90"
              aria-label="Open game sidebar"
            >
              <PanelLeft className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="gap-4 p-4 max-w-sm flex w-[85vw] flex-col border-surface-2 bg-surface-1"
          >
            <SheetHeader className="p-0">
              <SheetTitle className="text-text-secondary">
                Game sidebar
              </SheetTitle>
            </SheetHeader>
            {sidebarContent}
          </SheetContent>
        </Sheet>
      </div>

      {/* Commanders Panel – kept mounted via Activity for smooth slide animation */}
      {currentUser && (
        <Activity mode={panelOpen ? 'visible' : 'hidden'}>
          <GameStatsPanel
            isOpen={panelOpen}
            onClose={handleClosePanel}
            roomId={roomId}
            currentUser={currentUser}
            participants={uniqueParticipants}
          />
        </Activity>
      )}
    </>
  )
}

function SidebarLoading() {
  return (
    <div className="w-64 space-y-4 flex-shrink-0">
      {/* Player List Skeleton */}
      <Card className="p-4 border-surface-2 bg-surface-1">
        <div className="space-y-3">
          {/* Header with "Players" and count */}
          <div className="mb-2 flex items-center justify-between">
            <Skeleton className="h-4 w-16 bg-surface-3/50" />
            <Skeleton className="h-3 w-8 bg-surface-3/50" />
          </div>

          {/* Player items - show generic loading state */}
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="p-2 flex items-center justify-between rounded-lg border border-surface-2 bg-surface-2/50"
              >
                <div className="min-w-0 gap-2 flex flex-1 items-center">
                  <Skeleton className="h-2 w-2 rounded-full bg-surface-3/50" />
                  <Skeleton className="h-4 w-24 bg-surface-3/50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

export function GameRoomSidebar(props: GameRoomSidebarProps) {
  return (
    <Suspense fallback={<SidebarLoading />}>
      <SidebarContent {...props} />
    </Suspense>
  )
}
