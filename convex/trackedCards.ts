/**
 * Tracked Card Counter Mutations & Queries
 *
 * Owner-gated tracked-card instances per room. The owner (the player whose
 * webcam shows the card) is the only one allowed to add/remove counters or
 * untrack the card. Reads are open to anyone in the room.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

const COUNTER_KEYS = [
  'plus1plus1',
  'minus1minus1',
  'loyalty',
  'charge',
  'stun',
  'shield',
  'quest',
  'time',
] as const

const counterKeyValidator = v.union(...COUNTER_KEYS.map((k) => v.literal(k)))

type CounterKey = (typeof COUNTER_KEYS)[number]
type CounterMap = Partial<Record<CounterKey, number>>

export const listByRoom = query({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    return await ctx.db
      .query('trackedCards')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect()
  },
})

export const trackCard = mutation({
  args: {
    roomId: v.string(),
    scryfallId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    return await ctx.db.insert('trackedCards', {
      roomId: args.roomId,
      ownerUserId: userId,
      scryfallId: args.scryfallId,
      name: args.name,
      counters: {},
      createdAt: Date.now(),
    })
  },
})

export const untrackCard = mutation({
  args: { instanceId: v.id('trackedCards') },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    const doc = await ctx.db.get(instanceId)
    if (!doc) throw new Error('Not found')
    if (doc.ownerUserId !== userId) throw new Error('Forbidden')
    await ctx.db.delete(instanceId)
  },
})

function applyCounterValue(
  counters: CounterMap,
  type: CounterKey,
  value: number,
): CounterMap {
  const next: CounterMap = { ...counters }
  const clamped = Math.max(0, Math.floor(value))
  if (clamped === 0) {
    delete next[type]
  } else {
    next[type] = clamped
  }
  return next
}

export const setCounter = mutation({
  args: {
    instanceId: v.id('trackedCards'),
    type: counterKeyValidator,
    value: v.number(),
  },
  handler: async (ctx, { instanceId, type, value }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    const doc = await ctx.db.get(instanceId)
    if (!doc) throw new Error('Not found')
    if (doc.ownerUserId !== userId) throw new Error('Forbidden')
    await ctx.db.patch(instanceId, {
      counters: applyCounterValue(doc.counters, type, value),
    })
  },
})

export const bumpCounter = mutation({
  args: {
    instanceId: v.id('trackedCards'),
    type: counterKeyValidator,
    delta: v.number(),
  },
  handler: async (ctx, { instanceId, type, delta }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    const doc = await ctx.db.get(instanceId)
    if (!doc) throw new Error('Not found')
    if (doc.ownerUserId !== userId) throw new Error('Forbidden')
    const current = doc.counters[type] ?? 0
    await ctx.db.patch(instanceId, {
      counters: applyCounterValue(doc.counters, type, current + delta),
    })
  },
})
