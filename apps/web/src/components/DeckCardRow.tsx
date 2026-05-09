/**
 * Single card row inside a deck zone. Shows art crop, name, and
 * right-click context menu for moving between zones.
 */
import type { Id } from '@convex/_generated/dataModel'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@repo/ui/components/context-menu'

import type { Zone } from '@/hooks/useDeck'
import { ALL_ZONES, ZONE_LABELS } from '@/hooks/useDeck'

interface DeckCardRowProps {
  cardId: Id<'deckCards'>
  scryfallId: string
  name: string
  currentZone: Zone
  onMove: (cardId: Id<'deckCards'>, toZone: Zone) => void
  onClick?: () => void
}

const SCRYFALL_ART = (id: string) =>
  `https://api.scryfall.com/cards/${id}?format=image&version=art_crop`

export function DeckCardRow({
  cardId,
  scryfallId,
  name,
  currentZone,
  onMove,
  onClick,
}: DeckCardRowProps) {
  const otherZones = ALL_ZONES.filter((z) => z !== currentZone)

  const row = (
    <button
      type="button"
      onClick={onClick}
      className="gap-2 px-2 py-1 w-full flex items-center rounded-md text-left transition-colors hover:bg-surface-2/80"
    >
      <img
        src={SCRYFALL_ART(scryfallId)}
        alt={name}
        className="h-8 w-11 shrink-0 rounded object-cover"
        loading="lazy"
      />
      <span className="min-w-0 truncate text-xs text-text-secondary">
        {name}
      </span>
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to...</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {otherZones.map((zone) => (
              <ContextMenuItem
                key={zone}
                onSelect={() => onMove(cardId, zone)}
              >
                {ZONE_LABELS[zone]}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
