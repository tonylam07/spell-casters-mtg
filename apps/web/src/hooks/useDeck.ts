/**
 * Convex-backed hook for deck management in a game room.
 * Returns the live deck (subscribed) plus mutation callbacks.
 *
 * Follows the same pattern as useTrackedCards.ts — exposes bound
 * mutations directly without wrapping in useCallback.
 */
import type { Id } from '@convex/_generated/dataModel'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'

export type Zone =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'
  | 'sideboard'

export const ZONE_LABELS: Record<Zone, string> = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command',
  sideboard: 'Sideboard',
}

export const ALL_ZONES: Zone[] = [
  'library',
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'command',
  'sideboard',
]

export function useDeck(roomId: string, userId?: string) {
  const deck = useQuery(
    api.decks.getPlayerDeck,
    userId ? { roomId, userId } : 'skip',
  )

  const scryfallIds = useQuery(
    api.decks.getDeckScryfallIds,
    userId ? { roomId, userId } : 'skip',
  )

  const importDeckMutation = useMutation(api.decks.importDeck)
  const moveCardMutation = useMutation(api.decks.moveCard)
  const drawCardMutation = useMutation(api.decks.drawCard)
  const shuffleMutation = useMutation(api.decks.shuffleLibrary)
  const mulliganMutation = useMutation(api.decks.mulligan)
  const deleteDeckMutation = useMutation(api.decks.deleteDeck)

  const importDeck = (args: {
    name: string
    source: string
    sourceUrl?: string
    cards: Array<{
      scryfallId: string
      name: string
      quantity: number
      section: string
    }>
  }) => importDeckMutation({ roomId, ...args })

  const moveCard = (cardId: Id<'deckCards'>, toZone: Zone) =>
    moveCardMutation({ cardId, toZone })

  const drawCard = () => drawCardMutation({ roomId })

  const shuffle = () => shuffleMutation({ roomId })

  const mulligan = (drawCount: number) =>
    mulliganMutation({ roomId, drawCount })

  const deleteDeck = () => deleteDeckMutation({ roomId })

  return {
    deck,
    scryfallIds: scryfallIds ?? [],
    importDeck,
    moveCard,
    drawCard,
    shuffle,
    mulligan,
    deleteDeck,
  }
}
