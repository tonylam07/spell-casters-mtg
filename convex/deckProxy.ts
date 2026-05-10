/**
 * Server-side proxy for fetching decklists from Moxfield and Archidekt.
 *
 * Browser-side fetch to these APIs fails due to CORS restrictions.
 * This Convex action runs server-side, bypassing CORS.
 */

import { v } from 'convex/values'

import { action } from './_generated/server'

export const fetchMoxfieldDeck = action({
  args: { deckId: v.string() },
  handler: async (_ctx, { deckId }) => {
    const url = `https://api2.moxfield.com/v2/decks/all/${deckId}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SpellCasters/1.0',
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(
        `Moxfield API returned ${res.status}: ${res.statusText}`,
      )
    }

    const data = await res.json()
    return data
  },
})

export const fetchArchidektDeck = action({
  args: { deckId: v.string() },
  handler: async (_ctx, { deckId }) => {
    const url = `https://archidekt.com/api/decks/${deckId}/`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SpellCasters/1.0',
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(
        `Archidekt API returned ${res.status}: ${res.statusText}`,
      )
    }

    const data = await res.json()
    return data
  },
})
