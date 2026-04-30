/**
 * Game Event Mutations
 *
 * Handles turn advancement and storm counter tracking.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import {
  AuthRequiredError,
  RoomNotFoundError,
} from './errors'

const PRESENCE_THRESHOLD_MS = 30_000

/**
 * Advance to the next player's turn.
 *
 * Cycles currentTurnUserId through the active player list,
 * increments turnCount, and resets stormCount to 0.
 * Logs a turn_change event to roomEvents.
 */
export const advanceTurn = mutation({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    const callerId = await getAuthUserId(ctx)
    if (!callerId) {
      throw new AuthRequiredError()
    }

    const room = await ctx.db
      .query('rooms')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .first()

    if (!room) {
      throw new RoomNotFoundError()
    }

    // Get active players ordered by joinedAt so turn order is stable
    const presenceThreshold = Date.now() - PRESENCE_THRESHOLD_MS
    const activePlayers = await ctx.db
      .query('roomPlayers')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .filter((q) =>
        q.and(
          q.neq(q.field('status'), 'left'),
          q.gt(q.field('lastSeenAt'), presenceThreshold),
          // Only primary seats (not linked seats)
          q.neq(q.field('isLinkedSeat'), true),
        ),
      )
      .collect()

    if (activePlayers.length === 0) {
      return
    }

    // Deduplicate by userId (take first session per user)
    const seen = new Set<string>()
    const uniquePlayers = activePlayers.filter((p) => {
      if (seen.has(p.userId)) return false
      seen.add(p.userId)
      return true
    })

    // Sort by joinedAt for consistent turn order
    uniquePlayers.sort((a, b) => a.joinedAt - b.joinedAt)

    const currentTurnUserId = room.currentTurnUserId ?? uniquePlayers[0]?.userId
    const currentIndex = uniquePlayers.findIndex(
      (p) => p.userId === currentTurnUserId,
    )
    const nextIndex = (currentIndex + 1) % uniquePlayers.length
    const nextPlayer = uniquePlayers[nextIndex]

    if (!nextPlayer) return

    const nextTurnCount = (room.turnCount ?? 0) + 1

    await ctx.db.patch(room._id, {
      currentTurnUserId: nextPlayer.userId,
      turnCount: nextTurnCount,
      stormCount: 0,
      lastActivityAt: Date.now(),
    })

    // Log turn change event
    await ctx.db.insert('roomEvents', {
      roomId,
      type: 'turn_change',
      payload: {
        fromUserId: currentTurnUserId,
        toUserId: nextPlayer.userId,
        toUsername: nextPlayer.username,
        turnCount: nextTurnCount,
      },
      createdAt: Date.now(),
    })
  },
})

/**
 * Increment (or decrement) the storm counter for a room.
 * Storm resets automatically when advanceTurn fires.
 */
export const incrementStorm = mutation({
  args: {
    roomId: v.string(),
    delta: v.number(),
  },
  handler: async (ctx, { roomId, delta }) => {
    const callerId = await getAuthUserId(ctx)
    if (!callerId) {
      throw new AuthRequiredError()
    }

    const room = await ctx.db
      .query('rooms')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .first()

    if (!room) {
      throw new RoomNotFoundError()
    }

    const nextStorm = Math.max(0, (room.stormCount ?? 0) + delta)
    await ctx.db.patch(room._id, { stormCount: nextStorm })
  },
})

/**
 * Get the current turn state for a room.
 * Returns turnCount, stormCount, and currentTurnUserId.
 */
export const getTurnState = query({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .first()

    if (!room) return null

    return {
      currentTurnUserId: room.currentTurnUserId ?? null,
      turnCount: room.turnCount ?? 0,
      stormCount: room.stormCount ?? 0,
    }
  },
})

/**
 * Get recent life change events for a room (last 30, newest first).
 */
export const getLifeHistory = query({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const events = await ctx.db
      .query('roomEvents')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .filter((q) => q.eq(q.field('type'), 'life_change'))
      .order('desc')
      .take(30)

    return events
  },
})
