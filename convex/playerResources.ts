/**
 * Player Resource Mutations
 *
 * Adjust the calling player's poison / energy / experience counters in a
 * given room. Other players' values can only be read (via queries on
 * `roomPlayers`), not written.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { mutation } from './_generated/server'

const RESOURCE_KEYS = ['poison', 'energy', 'experience'] as const
const resourceKeyValidator = v.union(...RESOURCE_KEYS.map((k) => v.literal(k)))

export const setResource = mutation({
  args: {
    roomId: v.string(),
    type: resourceKeyValidator,
    value: v.number(),
  },
  handler: async (ctx, { roomId, type, value }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    const player = await ctx.db
      .query('roomPlayers')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!player) throw new Error('Player not in room')
    const clamped = Math.max(0, Math.floor(value))
    await ctx.db.patch(player._id, { [type]: clamped })
  },
})

export const bumpResource = mutation({
  args: {
    roomId: v.string(),
    type: resourceKeyValidator,
    delta: v.number(),
  },
  handler: async (ctx, { roomId, type, delta }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    const player = await ctx.db
      .query('roomPlayers')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!player) throw new Error('Player not in room')
    const playerRecord = player as Record<string, unknown>
    const current = (playerRecord[type] as number | undefined) ?? 0
    const next = Math.max(0, Math.floor(current + delta))
    await ctx.db.patch(player._id, { [type]: next })
  },
})
