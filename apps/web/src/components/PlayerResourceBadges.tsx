/**
 * Player-level resource badges (poison / energy / experience).
 * Click bumps +1; Shift+click bumps -1. Shows zero-value badges only when
 * the row is editable; remote/read-only views hide zero values.
 */
import { api } from '@convex/_generated/api'
import { useMutation } from 'convex/react'
import { Skull, Star, Zap } from 'lucide-react'

interface PlayerResourceBadgesProps {
  roomId: string
  poison: number
  energy: number
  experience: number
  editable: boolean
}

const ITEMS = [
  { key: 'poison' as const, icon: Skull, color: 'text-emerald-400' },
  { key: 'energy' as const, icon: Zap, color: 'text-amber-300' },
  { key: 'experience' as const, icon: Star, color: 'text-purple-300' },
]

export function PlayerResourceBadges({
  roomId,
  poison,
  energy,
  experience,
  editable,
}: PlayerResourceBadgesProps) {
  const bump = useMutation(api.playerResources.bumpResource)
  const values: Record<'poison' | 'energy' | 'experience', number> = {
    poison,
    energy,
    experience,
  }
  const visible = ITEMS.filter((item) => editable || values[item.key] > 0)
  if (visible.length === 0) return null

  return (
    <div className="gap-1.5 flex">
      {visible.map(({ key, icon: Icon, color }) => {
        const value = values[key]
        const handleClick = (event: React.MouseEvent) => {
          if (!editable) return
          void bump({
            roomId,
            type: key,
            delta: event.shiftKey ? -1 : 1,
          })
        }
        return (
          <button
            key={key}
            type="button"
            disabled={!editable}
            onClick={handleClick}
            aria-label={`${key}: ${value}`}
            className={`gap-1 px-1.5 py-0.5 text-xs inline-flex items-center rounded-md border border-surface-3 bg-surface-2/70 ${color} ${editable ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'}`}
          >
            <Icon className="h-3 w-3" />
            {value}
          </button>
        )
      })}
    </div>
  )
}
