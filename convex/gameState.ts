/**
 * Game State Mutations
 *
 * Commander tax, room roles (Monarch, Initiative, The Ring, City's Blessing),
 * and Day/Night cycle tracking.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { AuthRequiredError } from './errors'

const PRESENCE_THRESHOLD_MS = 30_000

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

async function getRoom(ctx: MutationCtx | QueryCtx, roomId: string) {
  return ctx.db
    .query('rooms')
    .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
    .first()
}

// ---------------------------------------------------------------------------
// Commander Tax
// ---------------------------------------------------------------------------

export const bumpCommanderTax = mutation({
  args: {
    roomId: v.string(),
    commanderId: v.string(),
    delta: v.number(), // +1 cast, -1 undo, 0 reset
  },
  handler: async (ctx, { roomId, commanderId, delta }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()

    const seats = await ctx.db
      .query('roomPlayers')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .collect()
    if (seats.length === 0) throw new Error('Player not in room')

    const current = (seats[0]?.commanderTax ?? {})[commanderId] ?? 0
    const next =
      delta === 0 ? 0 : Math.max(0, current + delta)

    await Promise.all(
      seats.map((seat) =>
        ctx.db.patch(seat._id, {
          commanderTax: { ...(seat.commanderTax ?? {}), [commanderId]: next },
        }),
      ),
    )
  },
})

// ---------------------------------------------------------------------------
// Room Roles — Monarch, Initiative, The Ring, City's Blessing
// ---------------------------------------------------------------------------

export const claimMonarch = mutation({
  args: { roomId: v.string(), targetUserId: v.optional(v.string()) },
  handler: async (ctx, { roomId, targetUserId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const room = await getRoom(ctx, roomId)
    if (!room) return
    await ctx.db.patch(room._id, { monarchUserId: targetUserId ?? userId })
  },
})

export const claimInitiative = mutation({
  args: { roomId: v.string(), targetUserId: v.optional(v.string()) },
  handler: async (ctx, { roomId, targetUserId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const room = await getRoom(ctx, roomId)
    if (!room) return
    await ctx.db.patch(room._id, { initiativeUserId: targetUserId ?? userId })
  },
})

export const claimRing = mutation({
  args: { roomId: v.string(), targetUserId: v.optional(v.string()) },
  handler: async (ctx, { roomId, targetUserId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const room = await getRoom(ctx, roomId)
    if (!room) return
    await ctx.db.patch(room._id, { thRingBearerUserId: targetUserId ?? userId })
  },
})

export const toggleCitysBlessing = mutation({
  args: { roomId: v.string(), targetUserId: v.optional(v.string()) },
  handler: async (ctx, { roomId, targetUserId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const room = await getRoom(ctx, roomId)
    if (!room) return
    const target = targetUserId ?? userId
    const current = room.citysBlessingUserIds ?? []
    const next = current.includes(target)
      ? current.filter((id) => id !== target)
      : [...current, target]
    await ctx.db.patch(room._id, { citysBlessingUserIds: next })
  },
})

export const clearRole = mutation({
  args: {
    roomId: v.string(),
    role: v.union(
      v.literal('monarch'),
      v.literal('initiative'),
      v.literal('ring'),
    ),
  },
  handler: async (ctx, { roomId, role }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const room = await getRoom(ctx, roomId)
    if (!room) return
    const patch: Record<string, null> = {
      monarch: { monarchUserId: null },
      initiative: { initiativeUserId: null },
      ring: { thRingBearerUserId: null },
    }[role] as Record<string, null>
    await ctx.db.patch(room._id, patch)
  },
})

// ---------------------------------------------------------------------------
// Day / Night
// ---------------------------------------------------------------------------

export const setDayNight = mutation({
  args: {
    roomId: v.string(),
    state: v.union(v.literal('day'), v.literal('night'), v.literal('none')),
  },
  handler: async (ctx, { roomId, state }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new AuthRequiredError()
    await requireRoomMember(ctx, roomId, userId)
    const room = await getRoom(ctx, roomId)
    if (!room) return
    await ctx.db.patch(room._id, {
      dayNightState: state === 'none' ? undefined : state,
    })
  },
})

// ---------------------------------------------------------------------------
// Query — returns all room-level game state in one call
// ---------------------------------------------------------------------------

export const getRoomGameState = query({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const room = await getRoom(ctx, roomId)
    if (!room) return null
    return {
      monarchUserId: room.monarchUserId ?? null,
      initiativeUserId: room.initiativeUserId ?? null,
      thRingBearerUserId: room.thRingBearerUserId ?? null,
      citysBlessingUserIds: room.citysBlessingUserIds ?? [],
      dayNightState: room.dayNightState ?? null,
    }
  },
})
