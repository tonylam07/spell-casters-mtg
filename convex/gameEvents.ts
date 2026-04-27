/**
 * Game Events — chat, dice rolls, turn management
 *
 * All events share the roomEvents table and are returned as a single
 * reactive feed for the GameLogPanel.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { AuthRequiredError } from './errors'

const DIE_SIDES: Record<string, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
  coin: 2,
}

const PRESENCE_THRESHOLD_MS = 30_000
const EVENTS_PAGE_SIZE = 100

async function requireRoomMember(
  ctx: MutationCtx | QueryCtx,
  roomId: string,
  userId: string,
) {
  const threshold = Date.now() - PRESENCE_THRESHOLD_MS
  const member = await ctx.db
    .query('roomPlayers')
    .withIndex('by_roomId_userId', (q) =>
      q.eq('roomId', roomId).eq('userId', userId),
    )
    .filter((q) =>
      q.and(
        q.neq(q.field('status'), 'left'),
        q.gt(q.field('lastSeenAt'), threshold),
      ),
    )
    .first()
  if (!member) throw new AuthRequiredError('Active room membership required')
  return member
}

async function getUsername(
  ctx: MutationCtx,
  roomId: string,
  userId: string,
): Promise<string> {
  const player = await ctx.db
    .query('roomPlayers')
    .withIndex('by_roomId_userId', (q) =>
      q.eq('roomId', roomId).eq('userId', userId),
    )
    .first()
  return player?.username ?? 'Unknown'
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const sendChat = mutation({
  args: {
    roomId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, { roomId, message }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const trimmed = message.trim().slice(0, 500)
    if (!trimmed) return
    const username = await getUsername(ctx, roomId, userId)
    await ctx.db.insert('roomEvents', {
      roomId,
      userId,
      username,
      type: 'chat',
      payload: { message: trimmed },
      createdAt: Date.now(),
    })
  },
})

export const rollDice = mutation({
  args: {
    roomId: v.string(),
    die: v.union(
      v.literal('d4'),
      v.literal('d6'),
      v.literal('d8'),
      v.literal('d10'),
      v.literal('d12'),
      v.literal('d20'),
      v.literal('coin'),
    ),
  },
  handler: async (ctx, { roomId, die }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const sides = DIE_SIDES[die] ?? 2
    const result = Math.floor(Math.random() * sides) + 1
    const username = await getUsername(ctx, roomId, userId)
    await ctx.db.insert('roomEvents', {
      roomId,
      userId,
      username,
      type: 'dice_roll',
      payload: { die, result, sides },
      createdAt: Date.now(),
    })
    return result
  },
})

export const advanceTurn = mutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)

    // Get all active unique players ordered by join time
    const allPlayers = await ctx.db
      .query('roomPlayers')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .filter((q) => q.neq(q.field('status'), 'left'))
      .collect()

    // Deduplicate by userId, keeping earliest joinedAt
    const seen = new Set<string>()
    const uniquePlayers: typeof allPlayers = []
    for (const p of allPlayers.sort((a, b) => a.joinedAt - b.joinedAt)) {
      if (!seen.has(p.userId)) {
        seen.add(p.userId)
        uniquePlayers.push(p)
      }
    }
    if (uniquePlayers.length === 0) return

    const room = await ctx.db
      .query('rooms')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .first()
    if (!room) return

    const currentTurnUserId = room.currentTurnUserId
    const currentIndex = uniquePlayers.findIndex(
      (p) => p.userId === currentTurnUserId,
    )
    const nextIndex = (currentIndex + 1) % uniquePlayers.length
    const nextPlayer = uniquePlayers[nextIndex]
    if (!nextPlayer) return
    const prevPlayer =
      currentIndex >= 0 ? uniquePlayers[currentIndex] : undefined

    await ctx.db.patch(room._id, { currentTurnUserId: nextPlayer.userId })

    const username = await getUsername(ctx, roomId, userId)
    await ctx.db.insert('roomEvents', {
      roomId,
      userId,
      username,
      type: 'turn_change',
      payload: {
        fromUserId: prevPlayer?.userId ?? null,
        fromUsername: prevPlayer?.username ?? null,
        toUserId: nextPlayer.userId,
        toUsername: nextPlayer.username,
      },
      createdAt: Date.now(),
    })
  },
})

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listEvents = query({
  args: {
    roomId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, limit = EVENTS_PAGE_SIZE }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()

    const events = await ctx.db
      .query('roomEvents')
      .withIndex('by_roomId_createdAt', (q) => q.eq('roomId', roomId))
      .order('desc')
      .take(limit)

    return events.reverse()
  },
})

export const getRoomTurn = query({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .first()
    return room?.currentTurnUserId ?? null
  },
})
