/**
 * Sidebar deck panel with zone tabs, card lists, and game actions
 * (draw, shuffle, mulligan). Only visible when a deck is loaded.
 */
import { useState } from 'react'
import type { Id } from '@convex/_generated/dataModel'
import {
  BookOpen,
  Hand,
  Layers,
  Loader2,
  RefreshCw,
  Skull,
  Swords,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@repo/ui/components/badge'
import { Button } from '@repo/ui/components/button'
import { ScrollArea } from '@repo/ui/components/scroll-area'

import type { Zone } from '@/hooks/useDeck'
import { ZONE_LABELS } from '@/hooks/useDeck'
import { CardDetailModal } from './CardDetailModal'
import { DeckCardRow } from './DeckCardRow'
import { SidebarCard } from './GameRoomSidebar'

type DeckCard = {
  _id: Id<'deckCards'>
  scryfallId: string
  name: string
  zone: string
  order: number
}

type DeckData = {
  name: string
  cardsByZone: Record<string, DeckCard[]>
}

interface DeckPanelProps {
  deck: DeckData
  onMoveCard: (cardId: Id<'deckCards'>, toZone: Zone) => void
  onDraw: () => Promise<{ name: string }>
  onShuffle: () => Promise<unknown>
  onMulligan: (drawCount: number) => Promise<unknown>
  onDelete: () => Promise<unknown>
}

const ZONE_ICONS: Record<Zone, React.ComponentType<{ className?: string }>> = {
  library: BookOpen,
  hand: Hand,
  battlefield: Swords,
  graveyard: Skull,
  exile: X,
  command: Layers,
  sideboard: Layers,
}

const ZONE_ORDER: Zone[] = [
  'hand',
  'battlefield',
  'library',
  'graveyard',
  'exile',
  'command',
  'sideboard',
]

export function DeckPanel({
  deck,
  onMoveCard,
  onDraw,
  onShuffle,
  onMulligan,
  onDelete,
}: DeckPanelProps) {
  const [activeZone, setActiveZone] = useState<Zone>('hand')
  const [mulliganCount, setMulliganCount] = useState(7)
  const [drawing, setDrawing] = useState(false)
  const [selectedCard, setSelectedCard] = useState<{
    name: string
    scryfallId: string
  } | null>(null)

  const zoneCards = (deck.cardsByZone[activeZone] ?? []) as DeckCard[]
  const totalCards = Object.values(deck.cardsByZone).reduce(
    (sum, cards) => sum + (cards as DeckCard[]).length,
    0,
  )

  const handleDraw = async () => {
    setDrawing(true)
    try {
      const result = await onDraw()
      toast.success(`Drew ${result.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draw failed')
    } finally {
      setDrawing(false)
    }
  }

  const handleMulligan = async () => {
    try {
      await onMulligan(mulliganCount)
      toast.success(`Mulligan to ${mulliganCount}`)
      setMulliganCount((c) => Math.max(1, c - 1))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mulligan failed')
    }
  }

  return (
    <>
      <SidebarCard
        icon={BookOpen}
        title={deck.name}
        count={`${totalCards}`}
        maxHeight="max-h-72"
        headerAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-5 w-5 p-0 text-text-muted hover:text-destructive"
            title="Remove deck"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        }
      >
        {/* Zone tabs */}
        <div className="gap-1 px-2 py-1.5 flex flex-wrap border-b border-surface-2">
          {ZONE_ORDER.map((zone) => {
            const count = (deck.cardsByZone[zone] ?? []).length
            const Icon = ZONE_ICONS[zone]
            const isActive = zone === activeZone
            return (
              <button
                key={zone}
                type="button"
                onClick={() => setActiveZone(zone)}
                className={`gap-1 px-1.5 py-0.5 inline-flex items-center rounded text-xs transition-colors ${
                  isActive
                    ? 'bg-brand/20 text-brand'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                <span>{ZONE_LABELS[zone]}</span>
                {count > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-0.5 h-4 min-w-4 px-1 text-[10px]"
                  >
                    {count}
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        {/* Zone actions */}
        {activeZone === 'library' && (
          <div className="gap-1 px-2 py-1 flex border-b border-surface-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDraw}
              disabled={drawing}
              className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-white"
            >
              {drawing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Draw'
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onShuffle()}
              className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-white"
            >
              <RefreshCw className="h-3 w-3" />
              Shuffle
            </Button>
          </div>
        )}

        {activeZone === 'hand' && (
          <div className="gap-1 px-2 py-1 flex items-center border-b border-surface-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMulligan}
              className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-white"
            >
              Mulligan to {mulliganCount}
            </Button>
          </div>
        )}

        {/* Card list */}
        <ScrollArea className="max-h-40">
          <div className="space-y-0.5 p-1">
            {zoneCards.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs italic text-text-muted">
                No cards in {ZONE_LABELS[activeZone]}
              </p>
            ) : (
              zoneCards.map((card) => (
                <DeckCardRow
                  key={card._id}
                  cardId={card._id}
                  scryfallId={card.scryfallId}
                  name={card.name}
                  currentZone={activeZone}
                  onMove={onMoveCard}
                  onClick={() =>
                    setSelectedCard({
                      name: card.name,
                      scryfallId: card.scryfallId,
                    })
                  }
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SidebarCard>

      {selectedCard && (
        <CardDetailModal
          open={!!selectedCard}
          onOpenChange={(open) => {
            if (!open) setSelectedCard(null)
          }}
          cardName={selectedCard.name}
          scryfallId={selectedCard.scryfallId}
        />
      )}
    </>
  )
}
