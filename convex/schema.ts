/**
 * Convex Schema - Database table definitions
 *
 * Defines the data model for room state, players, signaling, and bans.
 * @see SUPABASE_TO_CONVEX_PLAN.md Section 2.3 for constraints and indexes.
 */

import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Player status enum values
 */
export const playerStatusValues = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('left'),
)

export default defineSchema({
  // Include Convex Auth tables (users, sessions, etc.)
  ...authTables,

  /**
   * rooms - Room metadata
   *
   * Each room has a unique roomId (short shareable code) and an owner.
   */
  rooms: defineTable({
    /** Short shareable room code (e.g., "ABC123" - 6 character base-32 code) */
    roomId: v.string(),
    /** Discord user ID of the room owner */
    ownerId: v.string(),
    /** When the room was created */
    createdAt: v.number(),
    /** Number of player seats (1-4, default 4) */
    seatCount: v.optional(v.number()),
    /** Last time any activity occurred in the room (joins, leaves, state changes) */
    lastActivityAt: v.optional(v.number()),
    /** userId of the player whose turn it currently is */
    currentTurnUserId: v.optional(v.string()),
    /** Room-level game roles — transferred between players during play */
    monarchUserId: v.optional(v.string()),
    initiativeUserId: v.optional(v.string()),
    thRingBearerUserId: v.optional(v.string()),
    /** userIds who currently have City's Blessing (multiple players can hold it) */
    citysBlessingUserIds: v.optional(v.array(v.string())),
    /** Current day/night state for Innistrad mechanics */
    dayNightState: v.optional(v.union(v.literal('day'), v.literal('night'))),
  })
    .index('by_roomId', ['roomId'])
    .index('by_ownerId', ['ownerId'])
    .index('by_ownerId_createdAt', ['ownerId', 'createdAt']),

  /**
   * roomPlayers - Players in a room (also used for presence)
   *
   * Supports multi-tab sessions via sessionId.
   * lastSeenAt is used for heartbeat-based presence.
   */
  roomPlayers: defineTable({
    /** Reference to room */
    roomId: v.string(),
    /** Discord user ID */
    userId: v.string(),
    /** Session ID for multi-tab support */
    sessionId: v.string(),
    /** Player's display name */
    username: v.string(),
    /** Player's avatar URL */
    avatar: v.optional(v.string()),
    /** Player's current life total */
    health: v.number(),
    /** Player's current poison counters */
    poison: v.number(),
    /** Player's current energy counters (Commander) */
    energy: v.optional(v.number()),
    /** Player's current experience counters (Commander) */
    experience: v.optional(v.number()),
    /** Optional label for additional seats — "Tabletop", "Selfie", etc. */
    seatLabel: v.optional(v.string()),
    /** True for any seat after the user's first (primary) seat in this room */
    isLinkedSeat: v.optional(v.boolean()),
    /** Player's commander list (1-2 entries, owned by the player) */
    commanders: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      }),
    ),
    /** Per-commander damage taken, keyed by ownerUserId:commanderId */
    commanderDamage: v.record(v.string(), v.number()),
    /** Number of times each commander has been cast this game, keyed by commanderId */
    commanderTax: v.optional(v.record(v.string(), v.number())),
    /** Player status */
    status: playerStatusValues,
    /** When player joined */
    joinedAt: v.number(),
    /** Last heartbeat timestamp (for presence) */
    lastSeenAt: v.number(),
  })
    .index('by_roomId', ['roomId'])
    .index('by_roomId_sessionId', ['roomId', 'sessionId'])
    .index('by_roomId_userId', ['roomId', 'userId'])
    .index('by_roomId_lastSeenAt', ['roomId', 'lastSeenAt']),

  /**
   * roomSignals - WebRTC signaling messages
   *
   * Short-lived records for SDP offers/answers and ICE candidates.
   * Should be cleaned up after ~60s via scheduled cleanup.
   */
  roomSignals: defineTable({
    /** Reference to room */
    roomId: v.string(),
    /** Sender's Discord user ID */
    fromUserId: v.string(),
    /** Target user ID (null = broadcast to all peers) */
    toUserId: v.union(v.string(), v.null()),
    /** Signal payload (SDP, ICE candidate, etc.) */
    payload: v.any(),
    /** When signal was created */
    createdAt: v.number(),
  })
    .index('by_roomId', ['roomId'])
    .index('by_roomId_createdAt', ['roomId', 'createdAt'])
    .index('by_roomId_toUserId', ['roomId', 'toUserId'])
    .index('by_roomId_toUserId_createdAt', ['roomId', 'toUserId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  /**
   * roomBans - Persistent ban records
   *
   * Prevents banned users from rejoining a room.
   */
  roomBans: defineTable({
    /** Reference to room */
    roomId: v.string(),
    /** Banned user's Discord user ID */
    userId: v.string(),
    /** Discord user ID of who issued the ban */
    bannedBy: v.string(),
    /** Reason for the ban */
    reason: v.string(),
    /** When the ban was created */
    createdAt: v.number(),
  })
    .index('by_roomId', ['roomId'])
    .index('by_roomId_userId', ['roomId', 'userId']),

  /**
   * trackedCards - Player-tracked card instances with counters
   *
   * Created when a player chooses "Track this card" on a recognized card.
   * Persists for the life of the room. Owner-gated mutations (only the
   * card's ownerUserId may add/remove counters or untrack).
   */
  trackedCards: defineTable({
    /** Reference to room */
    roomId: v.string(),
    /** Discord user ID of card's owner (the player whose webcam shows it) */
    ownerUserId: v.string(),
    /** Scryfall card ID for art lookup */
    scryfallId: v.string(),
    /** Cached card name for display */
    name: v.string(),
    /** Counter map; absent key = 0 */
    counters: v.object({
      plus1plus1: v.optional(v.number()),
      minus1minus1: v.optional(v.number()),
      loyalty: v.optional(v.number()),
      charge: v.optional(v.number()),
      stun: v.optional(v.number()),
      shield: v.optional(v.number()),
      quest: v.optional(v.number()),
      time: v.optional(v.number()),
    }),
    /** When the instance was created */
    createdAt: v.number(),
  })
    .index('by_room', ['roomId'])
    .index('by_room_owner', ['roomId', 'ownerUserId']),

  /**
   * counters - Sequential counters for generating IDs
   *
   * Used to track total counts for various entities (e.g., rooms).
   */
  counters: defineTable({
    /** Counter name (e.g., "rooms") */
    name: v.string(),
    /** Total count */
    count: v.number(),
  }).index('by_name', ['name']),

  /**
   * userActiveRooms - Pointer to the user's current active room
   *
   * Used to enable "Rejoin last room" on the landing page.
   * One record per userId; upserted on join/heartbeat, cleared on leave/ban.
   */
  userActiveRooms: defineTable({
    /** Discord user ID */
    userId: v.string(),
    /** Room ID the user is currently in */
    roomId: v.string(),
    /** Last heartbeat timestamp (for presence TTL) */
    lastSeenAt: v.number(),
  }).index('by_userId', ['userId']),

  /**
   * roomEvents - Game log entries: chat messages, dice rolls, turn changes, join/leave
   *
   * Shared reactive feed used by the GameLogPanel for both the activity log
   * and in-room chat. Kept for the lifetime of the room (no TTL).
   */
  roomEvents: defineTable({
    roomId: v.string(),
    userId: v.string(),
    username: v.string(),
    type: v.union(
      v.literal('chat'),
      v.literal('dice_roll'),
      v.literal('turn_change'),
      v.literal('join'),
      v.literal('leave'),
    ),
    /** Type-specific data — shape depends on `type` */
    payload: v.any(),
    createdAt: v.number(),
  })
    .index('by_roomId_createdAt', ['roomId', 'createdAt'])
    .index('by_roomId', ['roomId']),
})
