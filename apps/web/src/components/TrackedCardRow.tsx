/**
 * One row inside the tracked-card tray. Mini art + name + counter badges.
 * Editable rows wrap in a right-click context menu for adding/removing
 * counter types and untracking.
 */
import type { CounterKey, CounterMap } from '@/lib/counter-types'
import type { Id } from '@convex/_generated/dataModel'
import { COUNTER_KEYS, COUNTER_META } from '@/lib/counter-types'
import { Trash2 } from 'lucide-react'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@repo/ui/components/context-menu'

import { CounterBadge } from './CounterBadge'

interface TrackedCardRowProps {
  instanceId: Id<'trackedCards'>
  scryfallId: string
  name: string
  counters: CounterMap
  editable: boolean
  onBump?: (type: CounterKey, delta: number) => void
  onUntrack?: () => void
  onClick?: () => void
}

const SCRYFALL_ART = (id: string) =>
  `https://api.scryfall.com/cards/${id}?format=image&version=art_crop`

export function TrackedCardRow({
  instanceId: _instanceId,
  scryfallId,
  name,
  counters,
  editable,
  onBump,
  onUntrack,
  onClick,
}: TrackedCardRowProps) {
  const activeKeys = COUNTER_KEYS.filter((k) => (counters[k] ?? 0) > 0)

  const row = (
    <div className="gap-2 px-2 py-1 flex items-center rounded-md bg-surface-2/60">
      <button
        type="button"
        onClick={onClick}
        className="gap-2 flex items-center min-w-0 text-left hover:opacity-80 transition-opacity"
      >
        <img
          src={SCRYFALL_ART(scryfallId)}
          alt={name}
          className="h-10 w-14 shrink-0 rounded object-cover"
          loading="lazy"
        />
        <div className="min-w-0">
          <div className="text-xs font-medium text-white truncate">{name}</div>
        </div>
      </button>
      <div className="ml-auto mt-0.5 gap-1 flex flex-wrap shrink-0">
        {activeKeys.length === 0 && (
          <span className="text-[10px] text-text-muted italic">
            no counters
          </span>
        )}
        {activeKeys.map((key) => (
          <CounterBadge
            key={key}
            type={key}
            count={counters[key] ?? 0}
            editable={editable}
            onChange={(delta) => onBump?.(key, delta)}
          />
        ))}
      </div>
    </div>
  )

  if (!editable) return row

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuSub>
          <ContextMenuSubTrigger>Add counter</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {COUNTER_KEYS.map((key) => (
              <ContextMenuItem key={key} onSelect={() => onBump?.(key, 1)}>
                +1 {COUNTER_META[key].label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {activeKeys.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Remove counter</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {activeKeys.map((key) => (
                <ContextMenuItem key={key} onSelect={() => onBump?.(key, -1)}>
                  -1 {COUNTER_META[key].label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onUntrack} className="text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Untrack card
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
