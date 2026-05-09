/**
 * Deck parsing and card resolution utilities
 *
 * Supports importing decks from:
 * - Moxfield (via API)
 * - Archidekt (via API)
 * - Plain text (inline format)
 *
 * Resolves card names to Scryfall data via batch API.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeckCard {
  name: string
  quantity: number
  section: 'main' | 'sideboard' | 'commander'
}

export interface ResolvedDeckCard extends DeckCard {
  scryfallId: string
  imageUrl: string
  typeLine: string
}

export interface ParseResult {
  name: string
  commander?: string
  cards: DeckCard[]
  error?: string
}

export interface ResolutionResult {
  resolved: ResolvedDeckCard[]
  unresolved: DeckCard[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MOXFIELD_API = 'https://api2.moxfield.com/v2/decks/all'
const ARCHIDEKT_API = 'https://archidekt.com/api/decks'
const SCRYFALL_API = 'https://api.scryfall.com'

/** Max cards per Scryfall batch request */
const SCRYFALL_BATCH_SIZE = 75

/** Delay between Scryfall batch requests (ms) */
const SCRYFALL_BATCH_DELAY_MS = 120

// ─────────────────────────────────────────────────────────────────────────────
// URL Extractors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract Moxfield deck ID from a URL
 * Handles formats: https://www.moxfield.com/decks/{id} or moxfield.com/decks/{id}
 */
export function extractMoxfieldId(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const match = urlObj.pathname.match(/\/decks\/([^/]+)/)
    return match ? match[1] : null
  } catch {
    // Try regex if URL parsing fails
    const match = url.match(/moxfield\.com\/decks\/([^/?#]+)/)
    return match ? match[1] : null
  }
}

/**
 * Extract Archidekt deck ID from a URL
 * Handles formats: https://www.archidekt.com/decks/{id} or archidekt.com/decks/{id}/
 */
export function extractArchidektId(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const match = urlObj.pathname.match(/\/decks\/(\d+)/)
    return match ? match[1] : null
  } catch {
    // Try regex if URL parsing fails
    const match = url.match(/archidekt\.com\/decks\/(\d+)/)
    return match ? match[1] : null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a deck from Moxfield API
 * Fetches the deck JSON and extracts mainboard, sideboard, and commanders
 */
export async function parseMoxfield(url: string): Promise<ParseResult> {
  const deckId = extractMoxfieldId(url)
  if (!deckId) {
    return { name: '', cards: [], error: 'Invalid Moxfield URL' }
  }

  try {
    const res = await fetch(`${MOXFIELD_API}/${deckId}`)
    if (!res.ok) {
      return { name: '', cards: [], error: 'Failed to fetch Moxfield deck' }
    }

    const data = await res.json()
    const cards: DeckCard[] = []

    // Parse mainboard
    if (data.mainboard) {
      for (const [cardName, entry] of Object.entries(data.mainboard)) {
        const deckEntry = entry as { quantity: number; card: { name: string } }
        cards.push({
          name: cardName,
          quantity: deckEntry.quantity,
          section: 'main',
        })
      }
    }

    // Parse sideboard
    if (data.sideboard) {
      for (const [cardName, entry] of Object.entries(data.sideboard)) {
        const deckEntry = entry as { quantity: number; card: { name: string } }
        cards.push({
          name: cardName,
          quantity: deckEntry.quantity,
          section: 'sideboard',
        })
      }
    }

    // Parse commanders
    let commander: string | undefined
    if (data.commanders) {
      for (const [cardName, entry] of Object.entries(data.commanders)) {
        const deckEntry = entry as { quantity: number; card: { name: string } }
        cards.push({
          name: cardName,
          quantity: deckEntry.quantity,
          section: 'commander',
        })
        if (!commander) {
          commander = cardName
        }
      }
    }

    return {
      name: data.name || 'Untitled Deck',
      commander,
      cards,
    }
  } catch (error) {
    return {
      name: '',
      cards: [],
      error: `Failed to parse Moxfield deck: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Parse a deck from Archidekt API
 * Fetches the deck JSON and extracts cards by category (main/sideboard/commander)
 */
export async function parseArchidekt(url: string): Promise<ParseResult> {
  const deckId = extractArchidektId(url)
  if (!deckId) {
    return { name: '', cards: [], error: 'Invalid Archidekt URL' }
  }

  try {
    const res = await fetch(`${ARCHIDEKT_API}/${deckId}/`)
    if (!res.ok) {
      return { name: '', cards: [], error: 'Failed to fetch Archidekt deck' }
    }

    const data = await res.json()
    const cards: DeckCard[] = []
    let commander: string | undefined

    // Parse cards array
    if (data.cards && Array.isArray(data.cards)) {
      for (const card of data.cards) {
        const cardName = card.card?.oracleCard?.name || card.card?.name
        if (!cardName) continue

        // Determine section based on categories
        let section: 'main' | 'sideboard' | 'commander' = 'main'
        const categories = card.categories || []
        if (categories.includes('Sideboard')) {
          section = 'sideboard'
        } else if (categories.includes('Commander')) {
          section = 'commander'
          if (!commander) {
            commander = cardName
          }
        }

        cards.push({
          name: cardName,
          quantity: card.quantity || 1,
          section,
        })
      }
    }

    return {
      name: data.name || 'Untitled Deck',
      commander,
      cards,
    }
  } catch (error) {
    return {
      name: '',
      cards: [],
      error: `Failed to parse Archidekt deck: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Parse a deck from plain text format
 * Supports formats like:
 *   4 Lightning Bolt
 *   4x Lightning Bolt
 *   Lightning Bolt x4
 *
 * Section headers recognized:
 *   // Sideboard
 *   // Commander
 */
export function parsePlainText(text: string): ParseResult {
  const cards: DeckCard[] = []
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)

  let currentSection: 'main' | 'sideboard' | 'commander' = 'main'

  for (const line of lines) {
    // Check for section headers (case-insensitive)
    const lowerLine = line.toLowerCase()
    if (lowerLine.includes('sideboard')) {
      currentSection = 'sideboard'
      continue
    }
    if (lowerLine.includes('commander')) {
      currentSection = 'commander'
      continue
    }

    // Skip comments and empty lines
    if (line.startsWith('//') || !line) continue

    // Parse card line: "quantity cardname" or "quantity x cardname" or "cardname x quantity"
    // Patterns: "4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt x4"
    const patterns = [
      /^(\d+)x?\s+(.+)$/, // "4 Lightning Bolt" or "4x Lightning Bolt"
      /^(.+?)\s+x(\d+)$/, // "Lightning Bolt x4"
    ]

    let matched = false
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match) {
        let quantity: number
        let name: string

        if (pattern === patterns[0]) {
          // First pattern: quantity is first, name is second
          quantity = parseInt(match[1], 10)
          name = match[2]
        } else {
          // Second pattern: name is first, quantity is second
          name = match[1]
          quantity = parseInt(match[2], 10)
        }

        if (!isNaN(quantity) && name && quantity > 0) {
          cards.push({
            name,
            quantity,
            section: currentSection,
          })
          matched = true
          break
        }
      }
    }

    if (!matched && line && !line.startsWith('//')) {
      // Try single card name with implicit quantity 1
      cards.push({
        name: line,
        quantity: 1,
        section: currentSection,
      })
    }
  }

  return {
    name: 'Imported Deck',
    cards,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scryfall Resolution
// ─────────────────────────────────────────────────────────────────────────────

interface ScryfallBatchIdentifier {
  name: string
}

interface ScryfallCard {
  id: string
  name: string
  type_line: string
  image_uris?: {
    normal: string
  }
}

interface ScryfallBatchResponse {
  object: string
  not_found?: Array<{ name: string }>
  data: ScryfallCard[]
}

/**
 * Resolve card names to Scryfall data via batch API
 * Uses POST /cards/collection with name identifiers
 * Handles batching (max 75 cards per request) and rate limiting
 */
export async function resolveWithScryfall(
  cards: DeckCard[],
): Promise<ResolutionResult> {
  const resolved: ResolvedDeckCard[] = []
  const unresolved: DeckCard[] = []

  // Deduplicate card names
  const uniqueNames = Array.from(new Set(cards.map((c) => c.name)))

  // Batch requests (max 75 per Scryfall batch API)
  for (let i = 0; i < uniqueNames.length; i += SCRYFALL_BATCH_SIZE) {
    const batch = uniqueNames.slice(i, i + SCRYFALL_BATCH_SIZE)

    // Add delay between batches to avoid rate limiting
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, SCRYFALL_BATCH_DELAY_MS))
    }

    try {
      const identifiers: ScryfallBatchIdentifier[] = batch.map((name) => ({
        name,
      }))

      const res = await fetch(`${SCRYFALL_API}/cards/collection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifiers }),
      })

      if (!res.ok) {
        // If batch request fails, mark all cards in batch as unresolved
        for (const name of batch) {
          const matchingCards = cards.filter((c) => c.name === name)
          unresolved.push(...matchingCards)
        }
        continue
      }

      const data: ScryfallBatchResponse = await res.json()
      const resolvedMap = new Map<
        string,
        { id: string; typeLine: string; imageUrl: string }
      >()

      // Map resolved cards by name
      if (data.data) {
        for (const scryfallCard of data.data) {
          const imageUrl =
            scryfallCard.image_uris?.normal ||
            'https://images.scryfall.io/cards/placeholder.jpg'
          resolvedMap.set(scryfallCard.name, {
            id: scryfallCard.id,
            typeLine: scryfallCard.type_line,
            imageUrl,
          })
        }
      }

      // Match original cards with resolved data
      for (const card of cards) {
        const scryfallData = resolvedMap.get(card.name)
        if (scryfallData) {
          resolved.push({
            ...card,
            scryfallId: scryfallData.id,
            imageUrl: scryfallData.imageUrl,
            typeLine: scryfallData.typeLine,
          })
        } else {
          unresolved.push(card)
        }
      }
    } catch (_error) {
      // If request fails, mark all cards in batch as unresolved
      for (const name of batch) {
        const matchingCards = cards.filter((c) => c.name === name)
        unresolved.push(...matchingCards)
      }
    }
  }

  // Remove duplicates from resolved/unresolved (keep only unique by name + section combo)
  const seenResolved = new Set<string>()
  const filteredResolved = resolved.filter((card) => {
    const key = `${card.name}:${card.section}`
    if (seenResolved.has(key)) return false
    seenResolved.add(key)
    return true
  })

  const seenUnresolved = new Set<string>()
  const filteredUnresolved = unresolved.filter((card) => {
    const key = `${card.name}:${card.section}`
    if (seenUnresolved.has(key)) return false
    seenUnresolved.add(key)
    return true
  })

  return {
    resolved: filteredResolved,
    unresolved: filteredUnresolved,
  }
}
