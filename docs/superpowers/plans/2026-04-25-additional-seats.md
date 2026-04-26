# Additional Seats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement docs/superpowers/specs/2026-04-25-additional-seats-design.md — let the same user join a room as a second linked seat (max 2 seats/user) with a custom label, primarily for selfie + tabletop dual-camera setups. Game state (life/poison/counters) stays shared across all seats for the same userId.

**Architecture:** Schema gets `seatLabel` + `isLinkedSeat` on `roomPlayers`. `joinRoom` accepts an `intentionalDuplicate` flag that bypasses dup detection and enforces a per-user seat cap. All mutations that touch shared per-player state patch every row for the userId so each tile renders in sync. New tab is launched via `window.open('/?join=...&seatLabel=...&intentional=1')` so it goes through the existing landing-page → game-room flow.

**Tech Stack:** Convex (schema, mutations), TanStack Start, React 19, existing UI primitives.

---

## File Structure

**Create:**
- `apps/web/src/components/AddSeatDialog.tsx` — label input + "Open in new tab" CTA
- `convex/__tests__/additionalSeats.test.ts` — server-side seat-cap + shared-state coverage

**Modify:**
- `convex/schema.ts` — add `seatLabel` + `isLinkedSeat` to `roomPlayers`
- `convex/errors.ts` — new `MaxSeatsReachedError`
- `convex/players.ts` — `joinRoom` accepts new args; shared-state mutations patch all rows
- `convex/playerResources.ts` — patch all rows for the calling user
- `apps/web/src/types/participant.ts` — optional `seatLabel`
- `apps/web/src/hooks/useConvexPresence.ts` — pipe through `seatLabel`/`intentionalDuplicate`
- `apps/web/src/contexts/PresenceContext.tsx` — same
- `apps/web/src/routes/index.tsx` — read `seatLabel` + `intentional` search params
- `apps/web/src/components/PlayerList.tsx` — group by userId; "+ Add camera" affordance
- `apps/web/src/components/VideoStreamGrid.tsx` — tile name suffix

---

## Task 1: Schema + error

**Files:**
- Modify: `convex/schema.ts`, `convex/errors.ts`

- [ ] **Step 1: Add fields to roomPlayers**

In `convex/schema.ts`, inside the existing `roomPlayers` table definition (after `experience`):

```ts
    /** Optional label for additional seats ("Tabletop", "Selfie", etc.) */
    seatLabel: v.optional(v.string()),
    /** True for the second+ seat from the same user (primary = first joined) */
    isLinkedSeat: v.optional(v.boolean()),
```

- [ ] **Step 2: Add MaxSeatsReachedError**

In `convex/errors.ts`, alongside `RoomFullError`:

```ts
export class MaxSeatsReachedError extends Error {
  constructor(maxSeats: number) {
    super(`User has already joined this room with ${maxSeats} seat(s)`)
    this.name = 'MaxSeatsReachedError'
  }
}
```

- [ ] **Step 3: Run codegen + commit**

```bash
bunx convex codegen
git add convex/
git commit -m "feat(schema): seatLabel + isLinkedSeat for additional-seat support"
```

---

## Task 2: Extend joinRoom

**Files:**
- Modify: `convex/players.ts`

- [ ] **Step 1: Add args + cap check**

Locate `export const joinRoom = mutation({ ... })`. Extend args:

```ts
args: {
  // ...existing
  seatLabel: v.optional(v.string()),
  intentionalDuplicate: v.optional(v.boolean()),
},
```

In the handler, after the `RoomNotFound` / `BannedFromRoom` checks but before the duplicate detection:

```ts
const MAX_SEATS_PER_USER = 2
const existingSeats = await ctx.db
  .query('roomPlayers')
  .withIndex('by_roomId_userId', (q) => q.eq('roomId', roomId).eq('userId', userId))
  .collect()

if (args.intentionalDuplicate) {
  if (existingSeats.length >= MAX_SEATS_PER_USER) {
    throw new MaxSeatsReachedError(MAX_SEATS_PER_USER)
  }
  // Skip duplicate-session detection — user explicitly opted in.
  // Insert directly with seatLabel + isLinkedSeat = true.
  return await ctx.db.insert('roomPlayers', {
    roomId, userId, sessionId,
    username, avatar,
    health: DEFAULT_HEALTH,
    poison: 0,
    commanders: existingSeats[0]?.commanders ?? [],
    commanderDamage: existingSeats[0]?.commanderDamage ?? {},
    status: 'active',
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    seatLabel: args.seatLabel?.slice(0, 40),
    isLinkedSeat: true,
  })
}

// Otherwise fall through to existing duplicate detection logic.
```

- [ ] **Step 2: Verify by codegen + commit**

```bash
bunx convex codegen
git add convex/players.ts
git commit -m "feat(convex): joinRoom accepts intentionalDuplicate + seatLabel"
```

---

## Task 3: Patch shared state across all rows for a user

**Files:**
- Modify: `convex/players.ts`, `convex/playerResources.ts`

- [ ] **Step 1: Helper to patch all rows**

In `convex/players.ts`, add at top of file:

```ts
async function patchAllSeats(
  ctx: MutationCtx,
  roomId: string,
  userId: string,
  patch: Partial<{ health: number; poison: number; commanders: ...; commanderDamage: ... }>,
) {
  const rows = await ctx.db
    .query('roomPlayers')
    .withIndex('by_roomId_userId', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .collect()
  await Promise.all(rows.map((row) => ctx.db.patch(row._id, patch)))
}
```

- [ ] **Step 2: Apply to setHealth / setPoison / setCommanders / setCommanderDamage**

Find each existing mutation (e.g. `updateHealth`, `updatePoison`, etc.) and replace the single `ctx.db.patch(player._id, ...)` call with `patchAllSeats(ctx, roomId, userId, ...)`.

- [ ] **Step 3: Same for playerResources mutations**

In `convex/playerResources.ts`, both `setResource` and `bumpResource` already look up the player by `(roomId, userId)`. Replace the single `.first()` + `ctx.db.patch` with a `.collect()` + `Promise.all` over all rows.

- [ ] **Step 4: Typecheck + commit**

```bash
bunx convex codegen
bunx tsc --noEmit -p convex
git add convex/
git commit -m "feat(convex): mutations patch all seats for a userId (shared state)"
```

---

## Task 4: AddSeatDialog component

**Files:**
- Create: `apps/web/src/components/AddSeatDialog.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Camera } from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'

interface AddSeatDialogProps {
  roomId: string
  trigger?: ReactNode
  /** Disabled when user already has 2 seats */
  disabled?: boolean
}

export function AddSeatDialog({ roomId, trigger, disabled }: AddSeatDialogProps) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('Tabletop')

  const onSubmit = () => {
    const trimmed = label.trim().slice(0, 40)
    if (!trimmed) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('join', roomId)
    url.searchParams.set('seatLabel', trimmed)
    url.searchParams.set('intentional', '1')
    window.open(url.toString(), '_blank', 'noopener')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" disabled={disabled}>
            <Camera className="mr-2 h-4 w-4" />
            Add camera
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add another camera</DialogTitle>
          <DialogDescription>
            Opens a new tab as a second seat for this room — useful for
            adding a tabletop view alongside your selfie cam. Life,
            poison, and counters stay synced between your seats.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="seat-label">Label this seat</Label>
          <Input
            id="seat-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="Tabletop"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={!label.trim()}>
            Open in new tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/AddSeatDialog.tsx
git commit -m "feat(web): AddSeatDialog — label input + new-tab join"
```

---

## Task 5: Pipe seatLabel + intentional through join flow

**Files:**
- Modify: `apps/web/src/routes/index.tsx`, `apps/web/src/contexts/PresenceContext.tsx`, `apps/web/src/hooks/useConvexPresence.ts`

- [ ] **Step 1: Search params on landing route**

In `routes/index.tsx`, extend `searchSchema`:

```ts
const searchSchema = z.object({
  error: z.string().optional(),
  join: z.string().optional(),
  seatLabel: z.string().optional(),
  intentional: z.string().optional(),
})
```

In the join useEffect, extract them:

```ts
const seatLabel = useSearch().seatLabel
const intentional = useSearch().intentional === '1'
// Stash both alongside the return URL for post-auth join
const target = `/game/${join}${seatLabel ? `?seatLabel=${encodeURIComponent(seatLabel)}&intentional=${intentional ? '1' : '0'}` : ''}`
```

- [ ] **Step 2: Pipe to joinRoom call**

Find where `joinRoom` is called in `useConvexPresence.ts`. Read the search params at the call site (via `Route.useSearch()` if inside a route component, or props). Pass `seatLabel` and `intentionalDuplicate` to the mutation args.

- [ ] **Step 3: Typecheck + commit**

```bash
bun --cwd apps/web tsc --noEmit
git add apps/web/src/{routes/index.tsx,contexts/PresenceContext.tsx,hooks/useConvexPresence.ts}
git commit -m "feat(web): pipe seatLabel + intentionalDuplicate through join flow"
```

---

## Task 6: PlayerList — group by userId + Add camera button

**Files:**
- Modify: `apps/web/src/components/PlayerList.tsx`, `apps/web/src/types/participant.ts`

- [ ] **Step 1: Add seatLabel to Participant type**

```ts
export interface Participant {
  // ...existing
  seatLabel?: string
  isLinkedSeat?: boolean
}
```

(Plumb through `useConvexPresence.ts` mapping from `roomPlayers` rows.)

- [ ] **Step 2: Group rendering**

In `PlayerList.tsx`, group `players` by `userId`:

```ts
const grouped = useMemo(() => {
  const map = new Map<string, Participant[]>()
  for (const p of players) {
    const arr = map.get(p.id) ?? []
    arr.push(p)
    map.set(p.id, arr)
  }
  return Array.from(map.values()).map((rows) => {
    rows.sort((a, b) => a.joinedAt - b.joinedAt)
    return { primary: rows[0]!, linked: rows.slice(1) }
  })
}, [players])
```

Render the existing row for `primary`, then for each `linked`:

```tsx
<div className="ml-6 flex items-center gap-2 py-1 text-xs text-text-muted">
  <Camera className="h-3 w-3" />
  <span>{linked.seatLabel ?? 'Additional camera'}</span>
</div>
```

- [ ] **Step 3: Add camera button under own row**

After the local user's primary row, when `currentSeatCount < 2`:

```tsx
<AddSeatDialog roomId={roomId} disabled={currentSeatCount >= 2} />
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun --cwd apps/web tsc --noEmit
git add apps/web/src/{components/PlayerList.tsx,types/participant.ts}
git commit -m "feat(web): group player rows by user + Add camera button"
```

---

## Task 7: VideoStreamGrid — tile name suffix

**Files:**
- Modify: `apps/web/src/components/VideoStreamGrid.tsx`

- [ ] **Step 1: Suffix on PlayerNameBadge**

Where `playerName` is rendered in `RemotePlayerCard`'s `PlayerNameBadge`:

```tsx
<span className="text-white">
  {playerName}
  {participantData.seatLabel ? (
    <span className="ml-1 text-text-muted">· {participantData.seatLabel}</span>
  ) : null}
</span>
```

Same on `LocalVideoCard` if a label is present (rare, since the local user's primary tile usually has no label).

- [ ] **Step 2: Typecheck + commit**

```bash
bun --cwd apps/web tsc --noEmit
git add apps/web/src/components/VideoStreamGrid.tsx
git commit -m "feat(web): show seatLabel suffix on remote player tiles"
```

---

## Task 8: Convex tests

**Files:**
- Create: `convex/__tests__/additionalSeats.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from '../_generated/api'
import schema from '../schema'

describe('additional seats', () => {
  it('joinRoom with intentionalDuplicate inserts a linked seat', async () => {
    const t = convexTest(schema)
    const asAlice = t.withIdentity({ subject: 'alice', name: 'Alice' })
    // First join (primary)
    await asAlice.mutation(api.players.joinRoom, { roomId: 'R1', sessionId: 's1', /* ... */ })
    // Second join intentional
    await asAlice.mutation(api.players.joinRoom, {
      roomId: 'R1', sessionId: 's2',
      seatLabel: 'Tabletop', intentionalDuplicate: true,
      /* ... */
    })
    const rows = await asAlice.query(api.players.listByRoom, { roomId: 'R1' })
    expect(rows.length).toBe(2)
    const linked = rows.find((r) => r.isLinkedSeat)
    expect(linked?.seatLabel).toBe('Tabletop')
  })

  it('rejects a 3rd seat with MaxSeatsReachedError', async () => {
    const t = convexTest(schema)
    const asAlice = t.withIdentity({ subject: 'alice' })
    await asAlice.mutation(api.players.joinRoom, { roomId: 'R1', sessionId: 's1', /* ... */ })
    await asAlice.mutation(api.players.joinRoom, {
      roomId: 'R1', sessionId: 's2', seatLabel: 'Tabletop', intentionalDuplicate: true,
    })
    await expect(
      asAlice.mutation(api.players.joinRoom, {
        roomId: 'R1', sessionId: 's3', seatLabel: 'Phone', intentionalDuplicate: true,
      }),
    ).rejects.toThrow(/Max seats/)
  })

  it('updateHealth patches all seats for the userId', async () => {
    const t = convexTest(schema)
    const asAlice = t.withIdentity({ subject: 'alice' })
    await asAlice.mutation(api.players.joinRoom, { roomId: 'R1', sessionId: 's1' })
    await asAlice.mutation(api.players.joinRoom, {
      roomId: 'R1', sessionId: 's2', intentionalDuplicate: true, seatLabel: 'X',
    })
    await asAlice.mutation(api.players.updateHealth, { roomId: 'R1', delta: -3 })
    const rows = await asAlice.query(api.players.listByRoom, { roomId: 'R1' })
    expect(new Set(rows.map((r) => r.health))).toEqual(new Set([37]))  // assuming default 40
  })
})
```

> **Note:** placeholders for `joinRoom` arg shape; consult the actual signature in players.ts when filling in.

- [ ] **Step 2: Run + commit**

```bash
bun --cwd convex vitest run __tests__/additionalSeats.test.ts
git add convex/__tests__/additionalSeats.test.ts
git commit -m "test(convex): additional-seats join + cap + shared-state coverage"
```

---

## Task 9: Final preflight + manual two-tab smoke test

- [ ] **Step 1: Preflight**

```bash
bun run preflight
```

- [ ] **Step 2: Manual two-tab smoke test (dev)**

```bash
bun run dev
```

- Tab 1: sign in, create a room.
- In the player list, click "+ Add camera" → label "Tabletop" → "Open in new tab".
- Tab 2 should auto-join with `seatLabel=Tabletop`. Both tabs visible as separate tiles.
- In Tab 2, increment a counter or change life — both tiles should reflect the same value.
- Try opening a 3rd tab via the same flow → should error toast "Max seats reached".

- [ ] **Step 3: Push + open PR**

```bash
git push
gh pr create --base setup-card-detection --title "feat: additional seats (multi-cam)" --body "Implements docs/superpowers/specs/2026-04-25-additional-seats-design.md"
```
