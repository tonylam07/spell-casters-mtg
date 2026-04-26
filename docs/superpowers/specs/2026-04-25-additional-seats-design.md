# Additional Seats (Multi-Cam) — Design Spec

**Status:** Draft, pending review
**Date:** 2026-04-25

## Goal

Allow the same user to join one room from multiple browser tabs / devices as additional seats. Primary use case: a player wants both a **selfie cam** (own face) and a **tabletop cam** (overhead, looking at the cards) at the same time. Secondary: share the same account across devices for testing.

## Decisions (locked from brainstorming)

| # | Question | Choice |
|---|---|---|
| 1 | Identity model | **B. Linked viewing seat.** Additional seats share the primary seat's life / poison / counters / commander state. Mutations on any seat update the shared state. Each seat renders as its own video tile. |
| 2 | Display naming | **B. User picks label.** Join dialog has a text input ("Label this seat", e.g. "Tabletop"). The label is shown as a suffix in the player list and on the tile (`Tony Lam · Tabletop`). |
| 3 | Per-user seat limit | **2** (one primary + one additional, e.g. selfie + tabletop). |

## Architecture

### Schema additions to `roomPlayers`

Existing table already supports multiple rows per `(roomId, userId)` via `sessionId`. Two new optional fields:

```ts
roomPlayers: defineTable({
  // ...existing fields (roomId, userId, sessionId, username, avatar, health,
  //   poison, energy, experience, commanders, commanderDamage, status,
  //   joinedAt, lastSeenAt)
  seatLabel: v.optional(v.string()),       // "Tabletop", "Selfie", etc.
  isLinkedSeat: v.optional(v.boolean()),   // true for any seat after the primary
})
```

The **primary seat** is the row with the smallest `joinedAt` for `(roomId, userId)`. All other rows are linked.

### Shared state semantics

Mutations that touch shared per-player state — `setHealth`, `bumpPoison`, `bumpResource`, `setCommanderDamage`, `setCommanders` — resolve the target by `(roomId, userId)` and patch **all rows** for that userId. This keeps every tile's display in sync without query-side joins.

Tracked cards (`trackedCards.ownerUserId`) and CLIP recognition results are already keyed by `userId`, so no change needed there — both tabs already operate on the same set.

### Joining as additional seat — flow

1. From the **game room sidebar** (player list area), the local user sees a "**+ Add camera**" button under their own row when:
   - They are already in this room (i.e., have at least one row), AND
   - The total seat count for their userId in this room is `< 2`.
2. Click → opens `<AddSeatDialog>`:
   - Label input (default value `Tabletop`; required, non-empty, ≤ 20 chars)
   - "Open in new tab" button (primary action)
3. Clicking opens `window.open()` with `/?join=ROOMID&seatLabel=Tabletop&intentional=1` in a new tab. The landing route handles the same as today's join flow but with two new search params.
4. The new tab calls `joinRoom({ ..., seatLabel: 'Tabletop', intentionalDuplicate: true })`. Server skips duplicate-session detection and inserts a new row.

### Duplicate-session handling

Today, `joinRoom` detects an existing row for the same userId (different sessionId) and triggers the `DuplicateSessionDialog`. We add:

- `intentionalDuplicate: v.optional(v.boolean())` arg to `joinRoom`
- When true: skip duplicate detection. Verify per-user seat count `< MAX_SEATS_PER_USER` (2); throw `MaxSeatsReachedError` if exceeded.
- When false / absent: existing dialog still fires. (Backward-compatible.)

### WebRTC

No protocol change. Each tab already gets its own `sessionId` and signals independently via `roomSignals` (keyed by sessionId). Other players' clients enumerate `roomPlayers` rows and open one peer connection per row. They already render N rows = N tiles.

### Tile rendering

`VideoStreamGrid` already iterates `gameRoomParticipants` to render player tiles. With this change:

- Each row in `roomPlayers` is one tile (already true).
- Tile name shows `${username}${seatLabel ? ` · ${seatLabel}` : ''}`.
- The linked-seat tile renders its own video stream, but stats (life/poison/counters) display the shared primary values. Mutations from any tile patch all rows.

### Player list (sidebar)

Group rows by userId; render the primary row's username + life/etc., then list each linked seat as an indented sub-row showing only the label and presence dot. Adding seats to the player count should count *unique users*, not rows (the existing `playerCount` metric).

## Data model — affected mutations

| Mutation | Change |
|---|---|
| `players.joinRoom` | Add `intentionalDuplicate?: boolean`, `seatLabel?: string` args. Skip dup detection when intentional. Enforce `MAX_SEATS_PER_USER`. |
| `players.setHealth` | Patch all rows for `(roomId, userId)`. |
| `players.setPoison` (or wherever) | Patch all rows. |
| `playerResources.{set,bump}Resource` | Patch all rows. |
| `players.setCommanders` / `setCommanderDamage` | Patch all rows. |
| `players.leaveRoom` | Only deletes the row matching `sessionId` (already correct). |

`trackedCards.*` mutations need no change — they're already keyed by `ownerUserId` not `sessionId`.

## UI changes

| File | Change |
|---|---|
| `convex/schema.ts` | Add `seatLabel` + `isLinkedSeat` to `roomPlayers`. |
| `convex/players.ts` | `joinRoom` accepts new args; mutations that update shared state patch all rows. |
| `convex/playerResources.ts` | Patch all rows for the userId. |
| `convex/errors.ts` | New `MaxSeatsReachedError`. |
| `apps/web/src/components/AddSeatDialog.tsx` | New dialog component (label input + "Open in new tab"). |
| `apps/web/src/components/PlayerList.tsx` | Group by userId, render sub-rows for linked seats; add "+ Add camera" affordance under own row. |
| `apps/web/src/components/VideoStreamGrid.tsx` | Tile name suffix from `seatLabel`. No grid layout change (already adapts to N tiles). |
| `apps/web/src/routes/index.tsx` | Read `seatLabel` and `intentional` search params; pass through the in-flight join. |
| `apps/web/src/contexts/PresenceContext.tsx` | Pass `seatLabel`/`intentionalDuplicate` to `joinRoom`. |
| `apps/web/src/hooks/useConvexPresence.ts` | Same. |
| `apps/web/src/types/participant.ts` | Add optional `seatLabel` field. |

## Permissions / auth

Adding a seat requires the user to be already authenticated and already a member of the room (or invited). The seat-count cap is enforced server-side. No new permission classes.

## Out of scope (future)

- Per-seat counters (would require Q1 = A or C)
- First-class same-tab multi-camera support (single tab acquires two `MediaStream`s and publishes both via one peer connection)
- Mobile camera-switching UI
- Different camera roles routed to different recognition pipelines (e.g. only the tabletop runs OpenCV detection)

## Open questions

None — all three decisions are locked. Proposed defaults from the spec are reversible at review.
