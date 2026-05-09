# Deck Import — Design Spec

**Date**: 2026-05-08
**Status**: Approved

## Overview

Import decklists from Moxfield, Archidekt, or plain text into the game room. Cards are stored in Convex with full MTG zone tracking (Library, Hand, Battlefield, Graveyard, Exile, Command Zone, Sideboard). A loaded deck also narrows card detection to ~100 deck cards first for sub-millisecond identification.

## Import Layer

### Three Parsers → Normalized Output

Each parser produces:

```ts
type DeckCard = {
  name: string
  quantity: number
  section: 'mainboard' | 'sideboard' | 'commander'
}
```

**Moxfield**: `GET https://api2.moxfield.com/v2/decks/all/{deckId}` — extract deck ID from URL pattern `moxfield.com/decks/{deckId}`. Response contains `mainboard`, `sideboard`, `commanders` objects keyed by card name with `quantity` fields.

**Archidekt**: `GET https://archidekt.com/api/decks/{deckId}/` — extract numeric ID from URL pattern `archidekt.com/decks/{id}/...`. Response contains `cards[]` array with `category` field mapping to sections (Commander → commander, Sideboard → sideboard, else → mainboard).

**Plain text**: Parse lines matching `(\d+)x?\s+(.+)` (e.g. `4 Lightning Bolt`, `1x Counterspell`). Support section headers `// Sideboard`, `// Commander` to assign sections. Default section is mainboard.

### Scryfall Resolution

After parsing, resolve unique card names to Scryfall data using the batch endpoint: `POST https://api.scryfall.com/cards/collection` with `identifiers: [{ name: "..." }]`. Accepts up to 75 cards per request — batch into multiple calls for large decks.

Returns `scryfallId`, art crop URL, oracle text, mana cost, type line. Cards not found are returned in `not_found[]` — flag these as unresolved for user review.

### Error Handling

- Invalid URL format → inline error message, no API call
- Moxfield/Archidekt 404 → "Deck not found. Check the URL and make sure the deck is public."
- Scryfall unresolved cards → show list of unresolved names, let user fix spelling or skip
- Network errors → toast with retry option

## Convex Data Layer

### Schema

```ts
// New table: decks
decks: defineTable({
  roomId: v.string(),
  userId: v.string(),
  name: v.string(),
  source: v.string(),            // "moxfield" | "archidekt" | "text"
  sourceUrl: v.optional(v.string()),
}).index('by_roomId_userId', ['roomId', 'userId']),

// New table: deckCards
deckCards: defineTable({
  deckId: v.id('decks'),
  scryfallId: v.string(),
  name: v.string(),
  quantity: v.number(),
  zone: v.string(),              // "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command" | "sideboard"
  order: v.number(),             // Position within zone (for library/hand ordering)
}).index('by_deckId_zone', ['deckId', 'zone']),
```

### Why Separate Tables

Individual card zone changes (draw, play, discard) are single-row mutations instead of rewriting the entire deck array. Convex reactive queries on `deckCards` filtered by zone make the UI update instantly per-zone.

### Mutations

- **`importDeck`** — create deck row, bulk insert deckCards. Zone assignment: mainboard → library (with random order for initial shuffle), sideboard → sideboard, commander → command.
- **`moveCard`** — update a card's `zone` and `order` fields. Handles: play (library/hand → battlefield), draw (library → hand), discard (any → graveyard), exile (any → exile), return (any → hand/library).
- **`shuffleLibrary`** — randomize `order` values for all cards in library zone.
- **`drawCard`** — find card with lowest `order` in library zone, move to hand.
- **`mulligan`** — move all hand cards back to library, shuffle, draw N cards (7 first time, then 6, 5...).
- **`deleteDeck`** — remove deck and all associated deckCards.

### Queries

- **`getPlayerDeck`** — by roomId + userId, returns deck + all cards grouped by zone.
- **`getDeckCardsByZone`** — by deckId + zone, returns cards ordered by `order` field. Used for reactive zone UIs.
- **`getDeckScryfallIds`** — by deckId, returns just scryfallId list for detection boost.

## UI Layer

### Deck Import Dialog

Triggered from a "Load Deck" button in the game sidebar. Structured as a dialog with three tabs:

- **Moxfield tab** — URL input field, paste `moxfield.com/decks/...`
- **Archidekt tab** — URL input field, paste `archidekt.com/decks/...`
- **Text tab** — textarea for pasting a plain text decklist

Workflow: paste URL/text → click "Load" → spinner while parsing + Scryfall resolution → preview showing deck name, card count, format, and any unresolved cards → "Import" button to confirm.

### Sidebar Deck Panel

Positioned below the Players section in the game sidebar. Only visible when a deck is loaded.

**Zone tabs**: Library, Hand, Battlefield, Graveyard, Exile, Command, Sideboard. Each tab shows a count badge. Active zone is expanded showing card rows; inactive zones show only the tab header with count.

**Card rows**: Same visual style as TrackedCardRow — mini art crop, card name, quantity if > 1. Click opens CardDetailModal.

**Zone actions**:
- Library: "Draw" button (top card → hand), "Shuffle" button
- Hand: "Mulligan" button (return to library, shuffle, draw N-1)
- All zones: right-click context menu → "Move to..." submenu listing all other zones

### Visibility Rules

- **Hand**: private — only the owning player can see their hand cards
- **All other zones**: public — visible to all players in the room
- This matches paper Magic conventions

### Detection Boost Integration

When a player has a deck loaded:

1. On CLIP search, extract the deck's Scryfall IDs
2. Filter the embedding database to just those ~100 entries
3. Run `top1` against the filtered set first
4. If best match score > 0.85, use it immediately (sub-millisecond)
5. If score ≤ 0.85, fall back to full 30k database search

When a detected card is in the player's deck and currently in the Library zone, show a prompt: "Move [card name] to Battlefield?" with Accept/Dismiss buttons.

## Files to Create/Modify

### New Files
- `apps/web/src/lib/deck-parsers.ts` — Moxfield, Archidekt, plain text parsers
- `apps/web/src/components/DeckImportDialog.tsx` — import dialog with 3 tabs
- `apps/web/src/components/DeckPanel.tsx` — sidebar deck panel with zone tabs
- `apps/web/src/components/DeckCardRow.tsx` — card row within a zone
- `apps/web/src/hooks/useDeck.ts` — hook wrapping Convex deck queries/mutations
- `convex/decks.ts` — Convex mutations and queries for deck management

### Modified Files
- `convex/schema.ts` — add `decks` and `deckCards` tables
- `apps/web/src/components/GameRoomSidebar.tsx` — add "Load Deck" button and DeckPanel
- `apps/web/src/lib/clip-search.ts` — add deck-scoped search function
- `apps/web/src/lib/setupCardDetector.ts` — integrate deck-scoped detection boost
