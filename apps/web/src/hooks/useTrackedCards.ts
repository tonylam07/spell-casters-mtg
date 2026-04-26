/**
 * Convex-backed hook for the tracked-card list of a room.
 * Returns the live list (subscribed) plus mutation callbacks.
 *
 * Mutation references from `useMutation` are not guaranteed referentially
 * stable across renders, so we expose the bound mutations directly without
 * wrapping in useCallback (the lint rule rejects unstable deps in useCallback).
 * Callers that need stable callbacks can wrap at the call site.
 */
import type { CounterKey } from '@/lib/counter-types'
import type { Id } from '@convex/_generated/dataModel'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'

export function useTrackedCards(roomId: string) {
  const cards = useQuery(api.trackedCards.listByRoom, { roomId }) ?? []
  const trackCardMutation = useMutation(api.trackedCards.trackCard)
  const untrackCardMutation = useMutation(api.trackedCards.untrackCard)
  const bumpMutation = useMutation(api.trackedCards.bumpCounter)
  const setMutation = useMutation(api.trackedCards.setCounter)

  const trackCard = (scryfallId: string, name: string) =>
    trackCardMutation({ roomId, scryfallId, name })
  const untrackCard = (instanceId: Id<'trackedCards'>) =>
    untrackCardMutation({ instanceId })
  const bump = (
    instanceId: Id<'trackedCards'>,
    type: CounterKey,
    delta: number,
  ) => bumpMutation({ instanceId, type, delta })
  const setCounter = (
    instanceId: Id<'trackedCards'>,
    type: CounterKey,
    value: number,
  ) => setMutation({ instanceId, type, value })

  return { cards, trackCard, untrackCard, bump, setCounter }
}
