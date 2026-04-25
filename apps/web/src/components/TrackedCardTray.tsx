/**
 * Tracked-card tray docked at the bottom of a webcam tile.
 * Hidden when there are no tracked cards for the relevant player.
 */
import type { CounterKey, CounterMap } from '@/lib/counter-types'
import type { Id } from '@convex/_generated/dataModel'

import { TrackedCardRow } from './TrackedCardRow'

export interface TrackedCardEntry {
  _id: Id<'trackedCards'>
  scryfallId: string
  name: string
  counters: CounterMap
}

interface TrackedCardTrayProps {
  cards: TrackedCardEntry[]
  editable: boolean
  onBump?: (id: Id<'trackedCards'>, type: CounterKey, delta: number) => void
  onUntrack?: (id: Id<'trackedCards'>) => void
}

export function TrackedCardTray({
  cards,
  editable,
  onBump,
  onUntrack,
}: TrackedCardTrayProps) {
  if (cards.length === 0) return null
  return (
    <div className="inset-x-2 bottom-2 max-h-32 p-1.5 backdrop-blur-sm absolute z-20 overflow-y-auto rounded-lg border border-surface-3 bg-surface-1/90">
      <div className="space-y-1">
        {cards.map((card) => (
          <TrackedCardRow
            key={card._id}
            instanceId={card._id}
            scryfallId={card.scryfallId}
            name={card.name}
            counters={card.counters}
            editable={editable}
            onBump={(type, delta) => onBump?.(card._id, type, delta)}
            onUntrack={() => onUntrack?.(card._id)}
          />
        ))}
      </div>
    </div>
  )
}
