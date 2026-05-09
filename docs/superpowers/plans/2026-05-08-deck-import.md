# Deck Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import decklists from Moxfield, Archidekt, or plain text into game rooms with full MTG zone tracking and deck-scoped detection boost.

**Architecture:** Three layers — (1) parsers that normalize external sources to a common `DeckCard[]`, (2) Convex backend with `decks` + `deckCards` tables and zone mutations, (3) React UI with import dialog, sidebar zone panel, and detection integration. Each card is a separate Convex row so zone changes are single-row mutations with reactive per-zone queries.

**Tech Stack:** Convex (backend), React + TanStack Router (frontend), shadcn/ui (Dialog, Tabs, Input, Textarea, Badge, ContextMenu, ScrollArea), Tailwind CSS, Scryfall API (card resolution)

**Spec:** `docs/superpowers/specs/2026-05-08-deck-import-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `convex/decks.ts` | Convex queries + mutations for deck/deckCard CRUD, zone moves, draw, shuffle, mulligan |
| `apps/web/src/lib/deck-parsers.ts` | Moxfield API, Archidekt API, plain text parsers + Scryfall batch resolution |
| `apps/web/src/hooks/useDeck.ts` | React hook wrapping Convex deck queries/mutations, bound to roomId |
| `apps/web/src/components/DeckImportDialog.tsx` | Import dialog with 3 tabs (Moxfield URL, Archidekt URL, Text) |
| `apps/web/src/components/DeckPanel.tsx` | Sidebar panel with zone tabs, card lists, draw/shuffle/mulligan actions |
| `apps/web/src/components/DeckCardRow.tsx` | Single card row in a zone — art crop, name, quantity, context menu for zone moves |

### Modified Files
| File | Change |
|------|--------|
| `convex/schema.ts` | Add `decks` and `deckCards` table definitions |
| `apps/web/src/components/GameRoomSidebar.tsx` | Add "Load Deck" button + `DeckPanel` component |
| `apps/web/src/lib/clip-search.ts` | Add `top1Scoped()` function for deck-scoped embedding search |

---

## Task 1: Convex Schema — Add `decks` and `deckCards` Tables

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add table definitions to schema**

Add these two tables inside the `defineSchema({})` call, after the `trackedCards` table:

```ts
  /**
   * decks - Imported decklists per player per room
   */
  decks: defineTable({
    roomId: v.string(),
    userId: v.string(),
    name: v.string(),
    source: v.string(),
    sourceUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_roomId_userId', ['roomId', 'userId']),

  /**
   * deckCards - Individual cards in a deck, assigned to zones
   */
  deckCards: defineTable({
    deckId: v.id('decks'),
    scryfallId: v.string(),
    name: v.string(),
    quantity: v.number(),
    zone: v.string(),
    order: v.number(),
  })
    .index('by_deckId_zone', ['deckId', 'zone'])
    .index('by_deckId', ['deckId']),
```

- [ ] **Step 2: Deploy schema to dev**

Run: `npx convex dev` (should already be running) — verify no schema errors in the terminal.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add decks and deckCards tables for deck import"
```

---

## Task 2: Convex Backend — Deck Mutations and Queries

**Files:**
- Create: `convex/decks.ts`

- [ ] **Step 1: Create the Convex functions file**

Create `convex/decks.ts` with all queries and mutations:

```ts
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
      // Delete all cards for the old deck
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
    let libraryOrder = 0
    for (const card of args.cards) {
      // Map section to initial zone
      let zone: string
      if (card.section === 'commander') {
        zone = 'command'
      } else if (card.section === 'sideboard') {
        zone = 'sideboard'
      } else {
        zone = 'library'
      }

      // For library cards, assign random order (shuffled)
      const order =
        zone === 'library' ? Math.random() * 1_000_000 : libraryOrder++

      // Insert one row per copy (quantity expanded)
      for (let i = 0; i < card.quantity; i++) {
        await ctx.db.insert('deckCards', {
          deckId,
          scryfallId: card.scryfallId,
          name: card.name,
          quantity: 1,
          zone,
          order: zone === 'library' ? Math.random() * 1_000_000 : order + i,
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

    // Find top card in library (lowest order)
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
      order: Date.now(), // Newest cards at end of hand
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

    // Assign new random order to each card
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

    // Shuffle entire library (including returned cards)
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

    // Draw N cards
    const reshuffled = await ctx.db
      .query('deckCards')
      .withIndex('by_deckId_zone', (q) =>
        q.eq('deckId', deck._id).eq('zone', 'library'),
      )
      .collect()
    reshuffled.sort((a, b) => a.order - b.order)

    const toDraw = reshuffled.slice(0, drawCount)
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
```

- [ ] **Step 2: Verify Convex dev picks up the new file**

Check the `convex dev` terminal — should show the new functions registered with no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/decks.ts
git commit -m "feat(convex): deck import mutations and queries with zone tracking"
```

---

## Task 3: Deck Parsers — Moxfield, Archidekt, Plain Text

**Files:**
- Create: `apps/web/src/lib/deck-parsers.ts`

- [ ] **Step 1: Create the parsers module**

```ts
/**
 * Deck parsers for Moxfield, Archidekt, and plain text formats.
 * Each parser normalizes to DeckCard[]. Scryfall resolution is separate.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DeckCard = {
  name: string
  quantity: number
  section: 'mainboard' | 'sideboard' | 'commander'
}

export type ResolvedDeckCard = DeckCard & {
  scryfallId: string
}

export type ParseResult = {
  name: string
  cards: DeckCard[]
  source: 'moxfield' | 'archidekt' | 'text'
  sourceUrl?: string
}

// ── URL Extraction ───────────────────────────────────────────────────────────

export function extractMoxfieldId(url: string): string | null {
  // Match: moxfield.com/decks/{id}
  const match = /moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/.exec(url.trim())
  return match?.[1] ?? null
}

export function extractArchidektId(url: string): string | null {
  // Match: archidekt.com/decks/{numeric-id}
  const match = /archidekt\.com\/decks\/(\d+)/.exec(url.trim())
  return match?.[1] ?? null
}

// ── Moxfield Parser ──────────────────────────────────────────────────────────

interface MoxfieldCard {
  quantity: number
  card: { name: string }
}

interface MoxfieldResponse {
  name: string
  mainboard: Record<string, MoxfieldCard>
  sideboard: Record<string, MoxfieldCard>
  commanders: Record<string, MoxfieldCard>
}

export async function parseMoxfield(url: string): Promise<ParseResult> {
  const deckId = extractMoxfieldId(url)
  if (!deckId) throw new Error('Invalid Moxfield URL. Expected: moxfield.com/decks/...')

  const res = await fetch(`https://api2.moxfield.com/v2/decks/all/${deckId}`)
  if (res.status === 404) {
    throw new Error('Deck not found. Check the URL and make sure the deck is public.')
  }
  if (!res.ok) throw new Error(`Moxfield API error: ${res.status}`)

  const data = (await res.json()) as MoxfieldResponse
  const cards: DeckCard[] = []

  for (const entry of Object.values(data.mainboard)) {
    cards.push({ name: entry.card.name, quantity: entry.quantity, section: 'mainboard' })
  }
  for (const entry of Object.values(data.sideboard)) {
    cards.push({ name: entry.card.name, quantity: entry.quantity, section: 'sideboard' })
  }
  for (const entry of Object.values(data.commanders)) {
    cards.push({ name: entry.card.name, quantity: entry.quantity, section: 'commander' })
  }

  return { name: data.name, cards, source: 'moxfield', sourceUrl: url }
}

// ── Archidekt Parser ─────────────────────────────────────────────────────────

interface ArchidektCard {
  quantity: number
  card: { oracleCard: { name: string } }
  categories: string[]
}

interface ArchidektResponse {
  name: string
  cards: ArchidektCard[]
}

export async function parseArchidekt(url: string): Promise<ParseResult> {
  const deckId = extractArchidektId(url)
  if (!deckId) throw new Error('Invalid Archidekt URL. Expected: archidekt.com/decks/...')

  const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`)
  if (res.status === 404) {
    throw new Error('Deck not found. Check the URL and make sure the deck is public.')
  }
  if (!res.ok) throw new Error(`Archidekt API error: ${res.status}`)

  const data = (await res.json()) as ArchidektResponse
  const cards: DeckCard[] = []

  for (const entry of data.cards) {
    const categories = entry.categories.map((c) => c.toLowerCase())
    let section: DeckCard['section'] = 'mainboard'
    if (categories.includes('commander')) {
      section = 'commander'
    } else if (categories.includes('sideboard')) {
      section = 'sideboard'
    }

    cards.push({
      name: entry.card.oracleCard.name,
      quantity: entry.quantity,
      section,
    })
  }

  return { name: data.name, cards, source: 'archidekt', sourceUrl: url }
}

// ── Plain Text Parser ────────────────────────────────────────────────────────

const CARD_LINE_RE = /^(\d+)x?\s+(.+)$/i
const SECTION_HEADER_RE = /^\/\/\s*(sideboard|commander|mainboard|maindeck)/i

export function parsePlainText(text: string): ParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const cards: DeckCard[] = []
  let currentSection: DeckCard['section'] = 'mainboard'

  for (const line of lines) {
    // Check for section header
    const sectionMatch = SECTION_HEADER_RE.exec(line)
    if (sectionMatch) {
      const header = (sectionMatch[1] ?? '').toLowerCase()
      if (header === 'sideboard') currentSection = 'sideboard'
      else if (header === 'commander') currentSection = 'commander'
      else currentSection = 'mainboard'
      continue
    }

    // Check for card line
    const cardMatch = CARD_LINE_RE.exec(line)
    if (cardMatch) {
      const quantity = parseInt(cardMatch[1] ?? '1', 10)
      const name = (cardMatch[2] ?? '').trim()
      if (name) {
        cards.push({ name, quantity, section: currentSection })
      }
    }
  }

  if (cards.length === 0) throw new Error('No cards found. Format: "4 Lightning Bolt"')

  return {
    name: 'Imported Deck',
    cards,
    source: 'text',
  }
}

// ── Scryfall Batch Resolution ────────────────────────────────────────────────

interface ScryfallCollectionResponse {
  data: Array<{ name: string; id: string }>
  not_found: Array<{ name: string }>
}

export type ResolutionResult = {
  resolved: ResolvedDeckCard[]
  unresolved: string[]
}

export async function resolveWithScryfall(
  cards: DeckCard[],
): Promise<ResolutionResult> {
  // Deduplicate card names for batch lookup
  const uniqueNames = [...new Set(cards.map((c) => c.name))]

  // Scryfall /cards/collection accepts max 75 identifiers per request
  const BATCH_SIZE = 75
  const nameToId = new Map<string, string>()
  const unresolvedNames: string[] = []

  for (let i = 0; i < uniqueNames.length; i += BATCH_SIZE) {
    const batch = uniqueNames.slice(i, i + BATCH_SIZE)
    const identifiers = batch.map((name) => ({ name }))

    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    })

    if (!res.ok) throw new Error(`Scryfall API error: ${res.status}`)

    const data = (await res.json()) as ScryfallCollectionResponse

    for (const card of data.data) {
      nameToId.set(card.name.toLowerCase(), card.id)
    }
    for (const nf of data.not_found) {
      unresolvedNames.push(nf.name)
    }

    // Scryfall rate limit: 10 req/s — add small delay between batches
    if (i + BATCH_SIZE < uniqueNames.length) {
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  // Map resolved IDs back to original cards
  const resolved: ResolvedDeckCard[] = []
  for (const card of cards) {
    const scryfallId = nameToId.get(card.name.toLowerCase())
    if (scryfallId) {
      resolved.push({ ...card, scryfallId })
    }
  }

  return { resolved, unresolved: unresolvedNames }
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd apps/web && bun run eslint src/lib/deck-parsers.ts --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/deck-parsers.ts
git commit -m "feat: deck parsers for Moxfield, Archidekt, plain text + Scryfall resolution"
```

---

## Task 4: React Hook — `useDeck`

**Files:**
- Create: `apps/web/src/hooks/useDeck.ts`

- [ ] **Step 1: Create the hook**

```ts
/**
 * Convex-backed hook for deck management in a game room.
 * Returns the live deck (subscribed) plus mutation callbacks.
 *
 * Follows the same pattern as useTrackedCards.ts — exposes bound
 * mutations directly without wrapping in useCallback.
 */
import type { Id } from '@convex/_generated/dataModel'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'

export type Zone =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'
  | 'sideboard'

export const ZONE_LABELS: Record<Zone, string> = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command',
  sideboard: 'Sideboard',
}

export const ALL_ZONES: Zone[] = [
  'library',
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'command',
  'sideboard',
]

export function useDeck(roomId: string, userId?: string) {
  const deck = useQuery(
    api.decks.getPlayerDeck,
    userId ? { roomId, userId } : 'skip',
  )

  const scryfallIds = useQuery(
    api.decks.getDeckScryfallIds,
    userId ? { roomId, userId } : 'skip',
  )

  const importDeckMutation = useMutation(api.decks.importDeck)
  const moveCardMutation = useMutation(api.decks.moveCard)
  const drawCardMutation = useMutation(api.decks.drawCard)
  const shuffleMutation = useMutation(api.decks.shuffleLibrary)
  const mulliganMutation = useMutation(api.decks.mulligan)
  const deleteDeckMutation = useMutation(api.decks.deleteDeck)

  const importDeck = (args: {
    name: string
    source: string
    sourceUrl?: string
    cards: Array<{
      scryfallId: string
      name: string
      quantity: number
      section: string
    }>
  }) => importDeckMutation({ roomId, ...args })

  const moveCard = (cardId: Id<'deckCards'>, toZone: Zone) =>
    moveCardMutation({ cardId, toZone })

  const drawCard = () => drawCardMutation({ roomId })

  const shuffle = () => shuffleMutation({ roomId })

  const mulligan = (drawCount: number) =>
    mulliganMutation({ roomId, drawCount })

  const deleteDeck = () => deleteDeckMutation({ roomId })

  return {
    deck,
    scryfallIds: scryfallIds ?? [],
    importDeck,
    moveCard,
    drawCard,
    shuffle,
    mulligan,
    deleteDeck,
  }
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd apps/web && bun run eslint src/hooks/useDeck.ts --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useDeck.ts
git commit -m "feat: useDeck hook for Convex deck queries and mutations"
```

---

## Task 5: Deck Import Dialog

**Files:**
- Create: `apps/web/src/components/DeckImportDialog.tsx`

- [ ] **Step 1: Create the import dialog component**

```tsx
import { useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs'
import { Textarea } from '@repo/ui/components/textarea'

import type { ResolvedDeckCard } from '@/lib/deck-parsers'
import {
  parseArchidekt,
  parseMoxfield,
  parsePlainText,
  resolveWithScryfall,
} from '@/lib/deck-parsers'

interface DeckImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (args: {
    name: string
    source: string
    sourceUrl?: string
    cards: Array<{
      scryfallId: string
      name: string
      quantity: number
      section: string
    }>
  }) => Promise<unknown>
}

type ImportState =
  | { step: 'input' }
  | { step: 'loading'; message: string }
  | {
      step: 'preview'
      name: string
      source: string
      sourceUrl?: string
      resolved: ResolvedDeckCard[]
      unresolved: string[]
    }

export function DeckImportDialog({
  open,
  onOpenChange,
  onImport,
}: DeckImportDialogProps) {
  const [state, setState] = useState<ImportState>({ step: 'input' })
  const [moxfieldUrl, setMoxfieldUrl] = useState('')
  const [archidektUrl, setArchidektUrl] = useState('')
  const [textInput, setTextInput] = useState('')

  const reset = () => {
    setState({ step: 'input' })
    setMoxfieldUrl('')
    setArchidektUrl('')
    setTextInput('')
  }

  const handleParse = async (
    parseFn: () => Promise<ReturnType<typeof parseMoxfield>>,
  ) => {
    setState({ step: 'loading', message: 'Fetching decklist...' })
    try {
      const parsed = await parseFn()
      setState({ step: 'loading', message: 'Resolving cards with Scryfall...' })
      const { resolved, unresolved } = await resolveWithScryfall(parsed.cards)
      setState({
        step: 'preview',
        name: parsed.name,
        source: parsed.source,
        sourceUrl: parsed.sourceUrl,
        resolved,
        unresolved,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      toast.error(message)
      setState({ step: 'input' })
    }
  }

  const handleConfirmImport = async () => {
    if (state.step !== 'preview') return
    setState({ step: 'loading', message: 'Importing deck...' })
    try {
      await onImport({
        name: state.name,
        source: state.source,
        sourceUrl: state.sourceUrl,
        cards: state.resolved.map((c) => ({
          scryfallId: c.scryfallId,
          name: c.name,
          quantity: c.quantity,
          section: c.section,
        })),
      })
      toast.success(`Deck "${state.name}" imported!`)
      reset()
      onOpenChange(false)
    } catch {
      toast.error('Failed to import deck')
      setState({ step: 'input' })
    }
  }

  const totalCards =
    state.step === 'preview'
      ? state.resolved.reduce((sum, c) => sum + c.quantity, 0)
      : 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-[480px] border-surface-2 bg-surface-1">
        <DialogHeader>
          <DialogTitle className="text-white">Load Deck</DialogTitle>
        </DialogHeader>

        {state.step === 'loading' && (
          <div className="gap-3 py-8 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <p className="text-sm text-text-muted">{state.message}</p>
          </div>
        )}

        {state.step === 'input' && (
          <Tabs defaultValue="moxfield" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-surface-2">
              <TabsTrigger value="moxfield">Moxfield</TabsTrigger>
              <TabsTrigger value="archidekt">Archidekt</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
            </TabsList>

            <TabsContent value="moxfield" className="space-y-3 pt-2">
              <Input
                placeholder="https://www.moxfield.com/decks/..."
                value={moxfieldUrl}
                onChange={(e) => setMoxfieldUrl(e.target.value)}
                className="border-surface-2 bg-surface-0 text-white"
              />
              <Button
                onClick={() =>
                  handleParse(() => parseMoxfield(moxfieldUrl))
                }
                disabled={!moxfieldUrl.trim()}
                className="w-full bg-brand text-white hover:bg-brand/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Load from Moxfield
              </Button>
            </TabsContent>

            <TabsContent value="archidekt" className="space-y-3 pt-2">
              <Input
                placeholder="https://archidekt.com/decks/..."
                value={archidektUrl}
                onChange={(e) => setArchidektUrl(e.target.value)}
                className="border-surface-2 bg-surface-0 text-white"
              />
              <Button
                onClick={() =>
                  handleParse(() => parseArchidekt(archidektUrl))
                }
                disabled={!archidektUrl.trim()}
                className="w-full bg-brand text-white hover:bg-brand/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Load from Archidekt
              </Button>
            </TabsContent>

            <TabsContent value="text" className="space-y-3 pt-2">
              <Textarea
                placeholder={"4 Lightning Bolt\n2 Counterspell\n// Sideboard\n2 Rest in Peace"}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="min-h-[160px] border-surface-2 bg-surface-0 font-mono text-sm text-white"
              />
              <Button
                onClick={() =>
                  handleParse(async () => parsePlainText(textInput))
                }
                disabled={!textInput.trim()}
                className="w-full bg-brand text-white hover:bg-brand/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Load from Text
              </Button>
            </TabsContent>
          </Tabs>
        )}

        {state.step === 'preview' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-white">{state.name}</h3>
              <p className="text-sm text-text-muted">
                {totalCards} cards · {state.resolved.length} unique ·{' '}
                {state.source}
              </p>
            </div>

            {state.unresolved.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
                <p className="mb-1 text-xs font-medium text-warning">
                  {state.unresolved.length} card(s) not found:
                </p>
                <ul className="space-y-0.5 text-xs text-text-muted">
                  {state.unresolved.map((name) => (
                    <li key={name}>• {name}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="max-h-48 overflow-y-auto rounded-md border border-surface-2 bg-surface-0 p-2">
              {state.resolved.map((card, i) => (
                <div
                  key={`${card.name}-${i}`}
                  className="px-2 py-0.5 flex items-center justify-between text-xs"
                >
                  <span className="text-text-secondary">
                    {card.quantity}x {card.name}
                  </span>
                  <span className="text-text-muted">{card.section}</span>
                </div>
              ))}
            </div>

            <div className="gap-2 flex">
              <Button
                onClick={handleConfirmImport}
                className="flex-1 bg-brand text-white hover:bg-brand/90"
              >
                Import Deck
              </Button>
              <Button
                variant="outline"
                onClick={reset}
                className="border-surface-2 text-text-muted"
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd apps/web && bun run eslint src/components/DeckImportDialog.tsx --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/DeckImportDialog.tsx
git commit -m "feat: DeckImportDialog with Moxfield, Archidekt, and text tabs"
```

---

## Task 6: Deck Card Row + Deck Panel

**Files:**
- Create: `apps/web/src/components/DeckCardRow.tsx`
- Create: `apps/web/src/components/DeckPanel.tsx`

- [ ] **Step 1: Create DeckCardRow component**

```tsx
/**
 * Single card row inside a deck zone. Shows art crop, name, and
 * right-click context menu for moving between zones.
 */
import type { Id } from '@convex/_generated/dataModel'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@repo/ui/components/context-menu'

import type { Zone } from '@/hooks/useDeck'
import { ALL_ZONES, ZONE_LABELS } from '@/hooks/useDeck'

interface DeckCardRowProps {
  cardId: Id<'deckCards'>
  scryfallId: string
  name: string
  currentZone: Zone
  onMove: (cardId: Id<'deckCards'>, toZone: Zone) => void
  onClick?: () => void
}

const SCRYFALL_ART = (id: string) =>
  `https://api.scryfall.com/cards/${id}?format=image&version=art_crop`

export function DeckCardRow({
  cardId,
  scryfallId,
  name,
  currentZone,
  onMove,
  onClick,
}: DeckCardRowProps) {
  const otherZones = ALL_ZONES.filter((z) => z !== currentZone)

  const row = (
    <button
      type="button"
      onClick={onClick}
      className="gap-2 px-2 py-1 w-full flex items-center rounded-md text-left transition-colors hover:bg-surface-2/80"
    >
      <img
        src={SCRYFALL_ART(scryfallId)}
        alt={name}
        className="h-8 w-11 shrink-0 rounded object-cover"
        loading="lazy"
      />
      <span className="min-w-0 truncate text-xs text-text-secondary">
        {name}
      </span>
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to...</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {otherZones.map((zone) => (
              <ContextMenuItem
                key={zone}
                onSelect={() => onMove(cardId, zone)}
              >
                {ZONE_LABELS[zone]}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

- [ ] **Step 2: Create DeckPanel component**

```tsx
/**
 * Sidebar deck panel with zone tabs, card lists, and game actions
 * (draw, shuffle, mulligan). Only visible when a deck is loaded.
 */
import { useState } from 'react'
import type { Id } from '@convex/_generated/dataModel'
import {
  BookOpen,
  Hand,
  Layers,
  Loader2,
  RefreshCw,
  Skull,
  Swords,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@repo/ui/components/badge'
import { Button } from '@repo/ui/components/button'
import { ScrollArea } from '@repo/ui/components/scroll-area'

import type { Zone } from '@/hooks/useDeck'
import { ZONE_LABELS } from '@/hooks/useDeck'
import { CardDetailModal } from './CardDetailModal'
import { DeckCardRow } from './DeckCardRow'
import { SidebarCard } from './GameRoomSidebar'

type DeckCard = {
  _id: Id<'deckCards'>
  scryfallId: string
  name: string
  zone: string
  order: number
}

type DeckData = {
  name: string
  cardsByZone: Record<string, DeckCard[]>
}

interface DeckPanelProps {
  deck: DeckData
  onMoveCard: (cardId: Id<'deckCards'>, toZone: Zone) => void
  onDraw: () => Promise<{ name: string }>
  onShuffle: () => Promise<void>
  onMulligan: (drawCount: number) => Promise<void>
  onDelete: () => Promise<void>
}

const ZONE_ICONS: Record<Zone, React.ComponentType<{ className?: string }>> = {
  library: BookOpen,
  hand: Hand,
  battlefield: Swords,
  graveyard: Skull,
  exile: X,
  command: Layers,
  sideboard: Layers,
}

const ZONE_ORDER: Zone[] = [
  'hand',
  'battlefield',
  'library',
  'graveyard',
  'exile',
  'command',
  'sideboard',
]

export function DeckPanel({
  deck,
  onMoveCard,
  onDraw,
  onShuffle,
  onMulligan,
  onDelete,
}: DeckPanelProps) {
  const [activeZone, setActiveZone] = useState<Zone>('hand')
  const [mulliganCount, setMulliganCount] = useState(7)
  const [drawing, setDrawing] = useState(false)
  const [selectedCard, setSelectedCard] = useState<{
    name: string
    scryfallId: string
  } | null>(null)

  const zoneCards = (deck.cardsByZone[activeZone] ?? []) as DeckCard[]
  const totalCards = Object.values(deck.cardsByZone).reduce(
    (sum, cards) => sum + (cards as DeckCard[]).length,
    0,
  )

  const handleDraw = async () => {
    setDrawing(true)
    try {
      const result = await onDraw()
      toast.success(`Drew ${result.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draw failed')
    } finally {
      setDrawing(false)
    }
  }

  const handleMulligan = async () => {
    try {
      await onMulligan(mulliganCount)
      toast.success(`Mulligan to ${mulliganCount}`)
      setMulliganCount((c) => Math.max(1, c - 1))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mulligan failed')
    }
  }

  return (
    <>
      <SidebarCard
        icon={BookOpen}
        title={deck.name}
        count={`${totalCards}`}
        maxHeight="max-h-72"
        headerAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-5 w-5 p-0 text-text-muted hover:text-destructive"
            title="Remove deck"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        }
      >
        {/* Zone tabs */}
        <div className="gap-1 px-2 py-1.5 flex flex-wrap border-b border-surface-2">
          {ZONE_ORDER.map((zone) => {
            const count = (deck.cardsByZone[zone] ?? []).length
            const Icon = ZONE_ICONS[zone]
            const isActive = zone === activeZone
            return (
              <button
                key={zone}
                type="button"
                onClick={() => setActiveZone(zone)}
                className={`gap-1 px-1.5 py-0.5 inline-flex items-center rounded text-xs transition-colors ${
                  isActive
                    ? 'bg-brand/20 text-brand'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                <span>{ZONE_LABELS[zone]}</span>
                {count > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-0.5 h-4 min-w-4 px-1 text-[10px]"
                  >
                    {count}
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        {/* Zone actions */}
        {activeZone === 'library' && (
          <div className="gap-1 px-2 py-1 flex border-b border-surface-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDraw}
              disabled={drawing}
              className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-white"
            >
              {drawing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Draw'
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onShuffle()}
              className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-white"
            >
              <RefreshCw className="h-3 w-3" />
              Shuffle
            </Button>
          </div>
        )}

        {activeZone === 'hand' && (
          <div className="gap-1 px-2 py-1 flex items-center border-b border-surface-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMulligan}
              className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-white"
            >
              Mulligan to {mulliganCount}
            </Button>
          </div>
        )}

        {/* Card list */}
        <ScrollArea className="max-h-40">
          <div className="space-y-0.5 p-1">
            {zoneCards.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs italic text-text-muted">
                No cards in {ZONE_LABELS[activeZone]}
              </p>
            ) : (
              zoneCards.map((card) => (
                <DeckCardRow
                  key={card._id}
                  cardId={card._id}
                  scryfallId={card.scryfallId}
                  name={card.name}
                  currentZone={activeZone}
                  onMove={onMoveCard}
                  onClick={() =>
                    setSelectedCard({
                      name: card.name,
                      scryfallId: card.scryfallId,
                    })
                  }
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SidebarCard>

      {selectedCard && (
        <CardDetailModal
          open={!!selectedCard}
          onOpenChange={(open) => {
            if (!open) setSelectedCard(null)
          }}
          cardName={selectedCard.name}
          scryfallId={selectedCard.scryfallId}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify lint passes**

Run: `cd apps/web && bun run eslint src/components/DeckCardRow.tsx src/components/DeckPanel.tsx --max-warnings 0`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/DeckCardRow.tsx apps/web/src/components/DeckPanel.tsx
git commit -m "feat: DeckCardRow and DeckPanel components with zone tabs and game actions"
```

---

## Task 7: Wire Sidebar — Add Load Deck Button + DeckPanel

**Files:**
- Modify: `apps/web/src/components/GameRoomSidebar.tsx`

- [ ] **Step 1: Add imports at the top of GameRoomSidebar.tsx**

Add after the existing imports:

```ts
import { BookOpen } from 'lucide-react'
import { useDeck } from '@/hooks/useDeck'
import { DeckImportDialog } from './DeckImportDialog'
import { DeckPanel } from './DeckPanel'
```

Note: `BookOpen` may need to be added to the existing `lucide-react` import line if it's not already there.

- [ ] **Step 2: Add deck state to SidebarContent**

Inside the `SidebarContent` function body (after the existing hooks around line 339), add:

```ts
  const { deck, importDeck, moveCard, drawCard, shuffle, mulligan, deleteDeck } =
    useDeck(roomId, user?.id)
  const [deckImportOpen, setDeckImportOpen] = useState(false)
```

Make sure `useState` is already imported (it is — check the existing import from 'react').

- [ ] **Step 3: Add DeckPanel to the sidebar content**

In the `sidebarContent` JSX (around line 430), add after the PlayerList section and before CardPreview:

```tsx
      {/* Deck Panel */}
      <div className="flex-shrink-0">
        {deck ? (
          <DeckPanel
            deck={deck}
            onMoveCard={moveCard}
            onDraw={drawCard}
            onShuffle={shuffle}
            onMulligan={mulligan}
            onDelete={deleteDeck}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeckImportOpen(true)}
            className="w-full gap-2 border-surface-2 text-text-muted hover:text-white"
          >
            <BookOpen className="h-4 w-4" />
            Load Deck
          </Button>
        )}
      </div>
```

- [ ] **Step 4: Add the DeckImportDialog**

At the bottom of the `SidebarContent` return, just before the closing `</>`, add:

```tsx
      <DeckImportDialog
        open={deckImportOpen}
        onOpenChange={setDeckImportOpen}
        onImport={importDeck}
      />
```

- [ ] **Step 5: Verify lint and typecheck pass**

Run: `cd apps/web && bun run eslint src/components/GameRoomSidebar.tsx --max-warnings 0 && bun run tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/GameRoomSidebar.tsx
git commit -m "feat: wire DeckPanel and import dialog into game sidebar"
```

---

## Task 8: Detection Boost — Deck-Scoped Search

**Files:**
- Modify: `apps/web/src/lib/clip-search.ts`

- [ ] **Step 1: Add deck-scoped search function**

Add this function after the existing `top1` function in `clip-search.ts`:

```ts
/**
 * Deck-scoped search: only checks embeddings for cards in the player's deck.
 * Returns the best match if score > threshold, otherwise null (caller should
 * fall back to full top1).
 *
 * @param q Query embedding (L2-normalized, 512-dim)
 * @param deckScryfallIds Scryfall IDs of cards in the player's deck
 * @param threshold Minimum score to accept (default 0.85)
 */
export function top1Scoped(
  q: Float32Array,
  deckScryfallIds: string[],
  threshold = 0.85,
): (CardMeta & { score: number }) | null {
  if (!db || !meta) return null
  if (deckScryfallIds.length === 0) return null

  const searchStart = performance.now()

  // Build a set of deck scryfall IDs for O(1) lookup
  const deckSet = new Set(deckScryfallIds)

  // Find indices of deck cards in the embedding database
  let best = -Infinity
  let idx = -1
  const n = meta.length

  for (let i = 0; i < n; i++) {
    const m = meta[i]
    if (!m?.scryfallId || !deckSet.has(m.scryfallId)) continue

    const dot = dotProduct(q, i)
    if (dot > best) {
      best = dot
      idx = i
    }
  }

  const searchDuration = performance.now() - searchStart
  console.log(
    `[top1Scoped] Deck search took ${searchDuration.toFixed(1)}ms — checked ${deckScryfallIds.length} deck cards, best=${best.toFixed(3)}`,
  )

  if (idx < 0 || best < threshold) {
    return null
  }

  const matchedMeta = meta[idx]
  if (!matchedMeta) return null

  return { ...matchedMeta, score: best }
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd apps/web && bun run eslint src/lib/clip-search.ts --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/clip-search.ts
git commit -m "feat: deck-scoped top1Scoped search for detection boost"
```

---

## Task 9: Deploy and Verify

- [ ] **Step 1: Run typecheck across the monorepo**

Run: `cd apps/web && bun run tsc --noEmit`

Expected: No errors.

- [ ] **Step 2: Run lint across the web app**

Run: `cd apps/web && bun run eslint . --max-warnings 0`

Expected: No errors, no warnings.

- [ ] **Step 3: Deploy Convex to production**

Run: `npx convex deploy`

Verify the new `decks` and `deckCards` tables appear in the dashboard.

- [ ] **Step 4: Push to develop and verify CI**

```bash
git push origin develop
```

Check the GitHub Actions "Web E2E" run passes (at least preflight).

- [ ] **Step 5: Manual smoke test**

1. Open https://spell-casters-mtg.vercel.app
2. Create a game room
3. Click "Load Deck" in sidebar
4. Paste a Moxfield URL (e.g., any public Commander deck)
5. Verify preview shows card list → click Import
6. Verify zone tabs appear with Library count
7. Click "Draw" a few times → cards move to Hand
8. Right-click a hand card → "Move to..." → Battlefield
9. Click "Shuffle" on Library
10. Click "Mulligan to 7" on Hand

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| Moxfield API parser | Task 3 |
| Archidekt API parser | Task 3 |
| Plain text parser | Task 3 |
| Scryfall batch resolution | Task 3 |
| `decks` table schema | Task 1 |
| `deckCards` table schema | Task 1 |
| importDeck mutation | Task 2 |
| moveCard mutation | Task 2 |
| drawCard mutation | Task 2 |
| shuffleLibrary mutation | Task 2 |
| mulligan mutation | Task 2 |
| deleteDeck mutation | Task 2 |
| getPlayerDeck query | Task 2 |
| getDeckScryfallIds query | Task 2 |
| Import dialog with 3 tabs | Task 5 |
| Sidebar deck panel with zone tabs | Task 6 |
| Card row with context menu zone moves | Task 6 |
| "Load Deck" button in sidebar | Task 7 |
| Detection boost (deck-scoped search) | Task 8 |
| Hand visibility (private) | Task 2 (query filters by userId) |
| Deploy + verify | Task 9 |
