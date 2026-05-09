/**
 * Deck Import — Convex queries and mutations
 *
 * Manages imported decklists with full MTG zone tracking.
 * Owner-gated: only the deck owner can modify their deck.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'

/** All valid MTG zones */
const ZONES = [
  'library',
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'command',
  'sideboard',
] as const

const zoneValidator = v.union(...ZONES.map((z) => v.literal(z)))

// ── Queries ──────────────────────────────────────────────────────────────────

export const getPlayerDeck = query({
  args: { roomId: v.string(), userId: v.string() },
  handler: async (ctx, { roomId, userId }) => {
    const deck = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!deck) return null

    const cards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .collect()

    // Group by zone
    const byZone: Record<string, typeof cards> = {}
    for (const zone of ZONES) {
      byZone[zone] = []
    }
    for (const card of cards) {
      const zoneCards = byZone[card.zone]
      if (zoneCards) {
        zoneCards.push(card)
      }
    }
    // Sort each zone by order
    for (const zone of ZONES) {
      byZone[zone]?.sort((a, b) => a.order - b.order)
    }

    return { ...deck, cardsByZone: byZone }
  },
})

export const getDeckScryfallIds = query({
  args: { roomId: v.string(), userId: v.string() },
  handler: async (ctx, { roomId, userId }) => {
    const deck = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!deck) return []

    const cards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .collect()

    // Deduplicate scryfall IDs
    return [...new Set(cards.map((c) => c.scryfallId))]
  },
})

// ── Mutations ────────────────────────────────────────────────────────────────

export const importDeck = mutation({
  args: {
    roomId: v.string(),
    name: v.string(),
    source: v.string(),
    sourceUrl: v.optional(v.string()),
    cards: v.array(
      v.object({
        scryfallId: v.string(),
        name: v.string(),
        quantity: v.number(),
        section: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')

    // Delete existing deck for this player in this room (one deck per player)
    const existing = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', args.roomId).eq('userId', userId),
      )
      .first()
    if (existing) {
      const oldCards = await ctx.db
        .query('deckCards')
        .withIndex('by_deckId', (q) => q.eq('deckId', existing._id))
        .collect()
      for (const card of oldCards) {
        await ctx.db.delete(card._id)
      }
      await ctx.db.delete(existing._id)
    }

    // Create new deck
    const deckId = await ctx.db.insert('decks', {
      roomId: args.roomId,
      userId,
      name: args.name,
      source: args.source,
      sourceUrl: args.sourceUrl,
      createdAt: Date.now(),
    })

    // Insert cards with zone assignment and random library order
    let sideboardOrder = 0
    for (const card of args.cards) {
      let zone: string
      if (card.section === 'commander') {
        zone = 'command'
      } else if (card.section === 'sideboard') {
        zone = 'sideboard'
      } else {
        zone = 'library'
      }

      // Insert one row per copy (quantity expanded)
      for (let i = 0; i < card.quantity; i++) {
        await ctx.db.insert('deckCards', {
          deckId,
          scryfallId: card.scryfallId,
          name: card.name,
          quantity: 1,
          zone,
          order: zone === 'library' ? Math.random() * 1_000_000 : sideboardOrder++,
        })
      }
    }

    return deckId
  },
})

export const moveCard = mutation({
  args: {
    cardId: v.id('deckCards'),
    toZone: zoneValidator,
  },
  handler: async (ctx, { cardId, toZone }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')

    const card = await ctx.db.get(cardId)
    if (!card) throw new Error('Card not found')

    const deck = await ctx.db.get(card.deckId)
    if (!deck) throw new Error('Deck not found')
    if (deck.userId !== userId) throw new Error('Forbidden')

    await ctx.db.patch(cardId, {
      zone: toZone,
      order: Math.random() * 1_000_000,
    })
  },
})

export const drawCard = mutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!deck) throw new Error('No deck loaded')

    const libraryCards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId_zone', (q) =>
        q.eq('deckId', deck._id).eq('zone', 'library'),
      )
      .collect()

    if (libraryCards.length === 0) throw new Error('Library is empty')

    libraryCards.sort((a, b) => a.order - b.order)
    const topCard = libraryCards[0]
    if (!topCard) throw new Error('Library is empty')

    await ctx.db.patch(topCard._id, {
      zone: 'hand',
      order: Date.now(),
    })

    return { name: topCard.name }
  },
})

export const shuffleLibrary = mutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!deck) throw new Error('No deck loaded')

    const libraryCards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId_zone', (q) =>
        q.eq('deckId', deck._id).eq('zone', 'library'),
      )
      .collect()

    for (const card of libraryCards) {
      await ctx.db.patch(card._id, {
        order: Math.random() * 1_000_000,
      })
    }
  },
})

export const mulligan = mutation({
  args: { roomId: v.string(), drawCount: v.number() },
  handler: async (ctx, { roomId, drawCount }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!deck) throw new Error('No deck loaded')

    // Move all hand cards back to library
    const handCards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId_zone', (q) =>
        q.eq('deckId', deck._id).eq('zone', 'hand'),
      )
      .collect()

    for (const card of handCards) {
      await ctx.db.patch(card._id, {
        zone: 'library',
        order: Math.random() * 1_000_000,
      })
    }

    // Re-query library and draw N cards
    const libraryCards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId_zone', (q) =>
        q.eq('deckId', deck._id).eq('zone', 'library'),
      )
      .collect()
    libraryCards.sort((a, b) => a.order - b.order)

    const toDraw = libraryCards.slice(0, drawCount)
    for (const card of toDraw) {
      await ctx.db.patch(card._id, {
        zone: 'hand',
        order: Date.now() + Math.random(),
      })
    }
  },
})

export const deleteDeck = mutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Unauthenticated')

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_roomId_userId', (q) =>
        q.eq('roomId', roomId).eq('userId', userId),
      )
      .first()
    if (!deck) return

    const cards = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .collect()

    for (const card of cards) {
      await ctx.db.delete(card._id)
    }
    await ctx.db.delete(deck._id)
  },
})
