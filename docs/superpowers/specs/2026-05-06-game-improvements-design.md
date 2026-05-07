# Game Improvements: Mobile Grid, Card State Wiring, Scryfall Modal

**Date:** 2026-05-06
**Status:** Approved

## Overview

Three improvements to the Spell Casters game room experience:

1. **Mobile video grid** — responsive stacking for small screens
2. **Card detection → game state** — wire "Add to Battlefield" to Convex tracked cards
3. **Scryfall card detail modal** — full card info modal from tracked cards tray

---

## 1. Mobile Video Grid

### Current State

`VideoStreamGrid.tsx` uses a single breakpoint:
```
grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-2
```
On mobile, tiles get squashed into 2 fixed rows regardless of player count.

### Design

CSS-only change in `VideoStreamGrid.tsx`:

| Breakpoint | Layout | Behavior |
|---|---|---|
| Mobile (<768px) | 1 column, auto rows | Vertical scroll, each tile `aspect-video` |
| Tablet (md, 768-1023px) | 2 columns, 2 rows | Same as current desktop |
| Desktop (lg+) | 2 columns, 2 rows | Unchanged |

**Changes:**
- Grid container: `grid grid-cols-1 gap-4 md:grid-cols-2 md:grid-rows-2 lg:grid-cols-2 lg:grid-rows-2`
- Mobile tiles: add `aspect-video` so each tile has consistent height
- Container: `overflow-y-auto` on mobile to allow scrolling when 3-4 players
- No component logic changes needed

### Files Modified
- `apps/web/src/components/VideoStreamGrid.tsx` — grid class changes only

---

## 2. Wire Card Detection → Game State

### Current State

The pipeline is fully built but disconnected:
- `CardScanner.tsx` line 299: `handleAddToBattlefield` is a TODO (just closes modal)
- `useTrackedCards.ts` already reads from Convex `trackedCards` table via `useQuery`
- Convex `trackedCards.add` mutation already exists
- `TrackedCardTray` already renders tracked cards from Convex
- `CardQueryContext` holds identified card results with `scryfallId`, `name`, `image_url`

### Design

Wire existing pieces — no new tables, no new state management.

**CardScanner path:**
```
CardScanner → user clicks "Add to Battlefield"
  → useMutation(api.trackedCards.add)({ roomId, scryfallId, name, ownerUserId })
  → TrackedCardTray auto-updates via live useQuery
```

**Video tile click path:**
The `CardQueryContext` already holds results. Add a "Track" action to the card query result UI that calls the same `trackedCards.add` mutation.

**Implementation:**
1. In `CardScanner.tsx`: replace TODO with Convex mutation call
2. Pass `roomId` as a prop to CardScanner (or get from context)
3. Use `useMutation(api.trackedCards.add)` to persist the identified card
4. Show toast confirmation on success

### Files Modified
- `apps/web/src/components/CardScanner.tsx` — wire handleAddToBattlefield
- Parent component passing `roomId` prop (if not already available)

---

## 3. Scryfall Card Detail Modal

### Current State

- `TrackedCardTray` renders card names as text + counter buttons
- `CardQueryResult` already has `scryfallId`, `image_url`, `card_url`
- Backend `/api/cards/:name` endpoint returns full Scryfall card objects
- Project uses shadcn `Dialog` components (see AddSeatDialog, RoomFullDialog)

### Design

New `CardDetailModal` component using shadcn Dialog.

**Trigger:** Click card name in `TrackedCardTray` or from `CardQueryResult` display.

**Modal Layout:**
```
┌─────────────────────────────────────┐
│  Card Name                     [X]  │
├──────────────┬──────────────────────┤
│              │ Mana Cost: {2}{U}{U} │
│  Card Image  │ Type: Instant        │
│  (normal)    │                      │
│              │ Oracle Text:         │
│              │ Counter target spell │
│              │                      │
│              │ Set: Alpha (R)       │
│              │                      │
│              │ P/T or Loyalty       │
├──────────────┴──────────────────────┤
│  [View on Scryfall]  [Remove Card]  │
└─────────────────────────────────────┘
```

**Data fetching:**
- On modal open, fetch `/api/cards/:name` for full Scryfall data
- Cache in a `Map<string, ScryfallCard>` ref to avoid re-fetching
- Show loading skeleton while fetching
- Handle 404 gracefully (card not found state)

**Props:**
```ts
interface CardDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cardName: string
  scryfallId?: string
  onRemove?: () => void  // for tracked cards — calls trackedCards.remove mutation
}
```

### Files Created
- `apps/web/src/components/CardDetailModal.tsx` — new modal component

### Files Modified
- `apps/web/src/components/TrackedCardTray.tsx` — add click handler to open modal
- `apps/web/src/components/CardQueryResult.tsx` (if exists) — add click to open modal

---

## Testing

- **Mobile grid:** Manual test with browser dev tools responsive mode (375px, 768px, 1024px)
- **Card wiring:** Create game, scan card, verify it appears in TrackedCardTray via Convex
- **Scryfall modal:** Click tracked card, verify image + oracle text loads, test "Remove" and "View on Scryfall"

## Out of Scope

- Deck import / deck management
- Persistent battlefield zones (graveyard, hand, library)
- Card counters on the modal (already handled by TrackedCardTray)
- Hover popover (using full modal instead)
