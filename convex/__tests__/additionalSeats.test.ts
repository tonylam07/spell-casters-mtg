import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api } from '../_generated/api'
import schema from '../schema'

// getAuthUserId splits identity.subject on "|" — so "alice|s1" → userId "alice"
const ALICE_ID = 'alice'
const ALICE_SUBJECT = `${ALICE_ID}|session-primary`

async function seedRoom(t: ReturnType<typeof convexTest>, roomId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert('rooms', {
      roomId,
      ownerId: ALICE_ID,
      createdAt: Date.now(),
      seatCount: 4,
    })
  })
}

const BASE_JOIN_ARGS = {
  username: 'Alice',
  audioEnabled: false,
  videoEnabled: false,
} as const

describe('additional seats', () => {
  it('joinRoom with intentionalDuplicate inserts a linked seat with seatLabel', async () => {
    const t = convexTest(schema)
    await seedRoom(t, 'ROOM1')
    const asAlice = t.withIdentity({ subject: ALICE_SUBJECT })

    // Primary seat
    await asAlice.mutation(api.players.joinRoom, {
      ...BASE_JOIN_ARGS,
      roomId: 'ROOM1',
      sessionId: 's-primary',
    })

    // Linked seat
    await asAlice.mutation(api.players.joinRoom, {
      ...BASE_JOIN_ARGS,
      roomId: 'ROOM1',
      sessionId: 's-tabletop',
      seatLabel: 'Tabletop',
      intentionalDuplicate: true,
    })

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('roomPlayers')
        .withIndex('by_roomId', (q) => q.eq('roomId', 'ROOM1'))
        .collect()
    })

    expect(rows).toHaveLength(2)
    const linked = rows.find((r) => r.isLinkedSeat)
    expect(linked).toBeDefined()
    expect(linked?.seatLabel).toBe('Tabletop')
  })

  it('rejects a 3rd seat with MaxSeatsReachedError', async () => {
    const t = convexTest(schema)
    await seedRoom(t, 'ROOM2')
    const asAlice = t.withIdentity({ subject: ALICE_SUBJECT })

    await asAlice.mutation(api.players.joinRoom, {
      ...BASE_JOIN_ARGS,
      roomId: 'ROOM2',
      sessionId: 's-primary',
    })
    await asAlice.mutation(api.players.joinRoom, {
      ...BASE_JOIN_ARGS,
      roomId: 'ROOM2',
      sessionId: 's-second',
      seatLabel: 'Tabletop',
      intentionalDuplicate: true,
    })

    await expect(
      asAlice.mutation(api.players.joinRoom, {
        ...BASE_JOIN_ARGS,
        roomId: 'ROOM2',
        sessionId: 's-third',
        seatLabel: 'Phone',
        intentionalDuplicate: true,
      }),
    ).rejects.toThrow(/already have 2 seat/)
  })

  it('bumpResource patches all seats for the userId', async () => {
    const t = convexTest(schema)
    await seedRoom(t, 'ROOM3')
    const asAlice = t.withIdentity({ subject: ALICE_SUBJECT })

    await asAlice.mutation(api.players.joinRoom, {
      ...BASE_JOIN_ARGS,
      roomId: 'ROOM3',
      sessionId: 's-primary',
    })
    await asAlice.mutation(api.players.joinRoom, {
      ...BASE_JOIN_ARGS,
      roomId: 'ROOM3',
      sessionId: 's-linked',
      seatLabel: 'Tabletop',
      intentionalDuplicate: true,
    })

    await asAlice.mutation(api.playerResources.bumpResource, {
      roomId: 'ROOM3',
      type: 'poison',
      delta: 3,
    })

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('roomPlayers')
        .withIndex('by_roomId', (q) => q.eq('roomId', 'ROOM3'))
        .collect()
    })

    expect(rows).toHaveLength(2)
    // Both seats should have poison = 3 (both patched by bumpResource)
    const poisonValues = new Set(rows.map((r) => r.poison))
    expect(poisonValues).toEqual(new Set([3]))
  })
})
