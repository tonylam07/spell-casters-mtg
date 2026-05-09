# QR Code Phone Camera + Feed Visibility Controls — Design Spec

**Date**: 2026-05-08
**Status**: Approved

## Overview

Two enhancements to the game room video experience:

1. **QR code in AddSeatDialog** — Players scan a QR code with their phone to use it as a tabletop camera, with a choice between adding a second camera tile or replacing their desktop webcam.
2. **Feed visibility toggles + responsive grid** — Any player can hide/show video tiles locally, and the grid layout adapts to the number of visible tiles.

Also includes a share link fix (already shipped): `CreateGameDialog` now uses `/?join=` format to avoid SSR 500.

## QR Code + Camera Mode

### AddSeatDialog Changes

The existing `AddSeatDialog` is updated with:

1. **Mode selector** — Two radio options at the top of the dialog:
   - **"Add as second camera"** (default) — Current linked-seat behavior. Creates a new `roomPlayers` row. Player gets two tiles (e.g. "Tony" + "Tony · Tabletop").
   - **"Replace my webcam"** — Phone takes over the existing seat's video feed. No new tile. Desktop shows a "Camera streaming from phone" placeholder.

2. **Seat label input** — Same as current, default "Tabletop". Only shown in "Add" mode (replace mode doesn't need a label since no new tile is created).

3. **QR code** — Rendered below the mode selector and label input using `qrcode.react` (SVG output). Encodes the full join URL. Updates live as the label changes. White QR on dark background for theme consistency. Below the QR: helper text "Scan with your phone's camera".

4. **"Open in new tab" button** — Stays as a fallback below the QR for same-device use.

### URL Formats

**Add mode** (second camera):
```
/?join={roomId}&seatLabel={label}&intentional=1
```

**Replace mode** (phone replaces webcam):
```
/?join={roomId}&replace=1
```

### Replace Mode — Backend

When `replace=1` is passed through to the game route:

1. The `joinRoom` mutation in `convex/players.ts` receives a `replaceCamera: true` flag.
2. Instead of inserting a new `roomPlayers` row, it patches the existing row for this user in this room — updating the `sessionId` to the phone's WebRTC session.
3. The max-seats check is skipped (no new seat is created).
4. If no existing row is found, fall back to normal join behavior.

### Replace Mode — Frontend

When the desktop detects that its `sessionId` has been replaced (the Convex reactive query on `roomPlayers` will update):

1. The desktop tab stops publishing its local camera stream.
2. The local video tile shows a placeholder: camera icon + "Camera streaming from phone".
3. The desktop retains full game UI (sidebar, card detection, life totals, etc.) — only the video source changes.

### Phone-Side Experience

The phone opens the game URL in its mobile browser:
- Hits the existing `/?join=ROOMID` landing route → auto-redirects to `/game/{roomId}`
- Auth gate shows if not logged in (same Wizards/Discord account)
- In "add" mode: joins as linked seat, full game UI on mobile (responsive layout already works)
- In "replace" mode: joins as camera-only — the game route detects `replace=1` and renders a minimal camera-only view (large viewfinder, no sidebar, no card history). This is a lightweight phone experience focused on just streaming video.

### QR Library

**`qrcode.react`** — Lightweight, React-native, renders as inline SVG. No server dependency. Widely used (~3M weekly npm downloads). Renders crisp at any size.

Install: `bun add qrcode.react` in `apps/web`.

## Feed Visibility Controls

### Per-Tile Toggle

Each video tile gets a small eye icon button in its top-right overlay corner (next to existing UI elements like the name badge). Behavior:

- **Click eye icon** → hides that tile from the local player's view only. Not broadcast to the room — purely client-side.
- **Hidden tiles** collapse out of the grid. The grid re-layouts to fill the space.
- A **"Show all"** button appears (floating, bottom-center of the grid area) when any tiles are hidden, showing a count: "Show all (2 hidden)".

### Responsive Grid

Replace the current hardcoded `grid-cols-2 grid-rows-2` with adaptive layout based on visible tile count:

| Visible tiles | Desktop (md+) | Mobile (<md) |
|---|---|---|
| 1 | Full width, constrained max height | Full width |
| 2 | 2 columns, 1 row | 1 column, stacked |
| 3 | 2 columns — first row has 2 tiles, second row has 1 centered | 1 column, stacked |
| 4 | 2 columns, 2 rows | 1 column, scrollable |
| 5+ | 2 columns, scrollable rows | 1 column, scrollable |

Mobile remains single-column stacked in all cases (current behavior), with vertical scroll when tiles exceed viewport.

### State Management

- **Hidden tiles:** `Set<string>` of session IDs, stored in `useState` within `VideoStreamGrid`. Resets on unmount (leaving the room). No persistence needed.
- **Empty slot placeholders** (dashed-border seats) are also excluded from the visible count — only active feeds with real streams count toward the grid layout calculation.
- When a player disconnects, their tile is automatically removed from the hidden set if it was hidden.

### Grid Class Logic

```ts
function getGridClass(visibleCount: number): string {
  switch (visibleCount) {
    case 1:
      return 'grid-cols-1 auto-rows-[minmax(300px,1fr)]'
    case 2:
      return 'grid-cols-1 auto-rows-[minmax(200px,1fr)] md:grid-cols-2 md:grid-rows-1'
    case 3:
      return 'grid-cols-1 auto-rows-[minmax(200px,1fr)] md:grid-cols-2 md:auto-rows-[minmax(200px,1fr)]'
    default: // 4+
      return 'grid-cols-1 auto-rows-[minmax(200px,1fr)] md:grid-cols-2 md:grid-rows-2'
  }
}
```

For the 3-tile case, the third tile spans the full bottom row centered using `md:col-span-2 md:max-w-[50%] md:mx-auto` or similar.

## Error Handling

- **QR scan fails to load** — phone user can manually type the URL shown below the QR code (small text fallback).
- **Replace mode with no existing seat** — falls back to normal join (creates a new seat).
- **Phone auth mismatch** — auth gate shows login dialog, same as any unauthenticated access. After login, redirects to the game room.
- **Phone loses connection** — desktop detects session change via Convex reactive query and can reclaim its own camera.

## Files to Modify

### Modified Files
- `apps/web/src/components/AddSeatDialog.tsx` — radio mode selector, QR code rendering, URL building for both modes
- `apps/web/src/components/VideoStreamGrid.tsx` — hidden tiles state, responsive grid logic, "Show all" button
- `apps/web/src/components/PlayerVideoCardParts.tsx` — eye icon toggle button in tile overlay
- `apps/web/src/routes/index.tsx` — pass through `replace` search param
- `apps/web/src/routes/_authed/game.$gameId.tsx` — accept `replace` search param, render minimal camera view when `replace=1`
- `convex/players.ts` — `replaceCamera` flag in `joinRoom` mutation

### New Dependencies
- `qrcode.react` — QR code SVG rendering
