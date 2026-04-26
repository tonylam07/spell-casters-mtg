/**
 * Player Resource Mutations
 *
 * Adjust the calling player's poison / energy / experience counters in a
 * given room. Other players' values can only be read (via queries on
 * `roomPlayers`), not written.
 *
 * When the user has multiple seats in the room (e.g. selfie + tabletop),
 * the resource value is patched on every seat row so all tiles render in
 * sync.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { MutationCtx } from './_generated/server'
import { mutation } from './_generated/server'

const RESOURCE_KEYS = ['poison', 'energy', 'experience'] as const
const resourceKeyValidator = v.union(...RESOURCE_KEYS.map((k) => v.literal(k)))

async function fetchAllSeats(
  ctx: MutationCtx,
  roomId: string,
  userId: string,
) {
  return await ctx.db
    .query('roomPlayers')
    .withIndex('by_roomId_userId', (q) =>
      q.eq('roomId', roomId).eq('userId', userId),
    )
    .collect()
}

export const setResource = mutation({
  args: {
    roomId: v.string(),
    type: resourceKeyValidator,
    value: v.number(),
  },
  handler: async (ctx, { roomId, type, value }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')
    const seats = await fetchAllSeats(ctx, roomId, userId)
    if (seats.length === 0) throw new Error('Player not in room')
    const clamped = Math.max(0, Math.floor(value))
    await Promise.all(
      seats.map((seat) => ctx.db.patch(seat._id, { [type]: clamped })),
    )
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
    const seats = await fetchAllSeats(ctx, roomId, userId)
    if (seats.length === 0) throw new Error('Player not in room')
    const playerRecord = seats[0] as Record<string, unknown>
    const current = (playerRecord[type] as number | undefined) ?? 0
    const next = Math.max(0, Math.floor(current + delta))
    await Promise.all(
      seats.map((seat) => ctx.db.patch(seat._id, { [type]: next })),
    )
  },
})
