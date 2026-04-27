import { api } from '@convex/_generated/api'
import { useQuery } from 'convex/react'

export interface RoomGameState {
  monarchUserId: string | null
  initiativeUserId: string | null
  thRingBearerUserId: string | null
  citysBlessingUserIds: string[]
  dayNightState: 'day' | 'night' | null
}

export function useRoomGameState(roomId: string): RoomGameState | null {
  return useQuery(api.gameState.getRoomGameState, { roomId }) ?? null
}
