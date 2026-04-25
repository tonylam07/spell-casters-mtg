import type { CounterKey } from '@/lib/counter-types'
import { COUNTER_META } from '@/lib/counter-types'

/**
 * CounterBadge — single counter pill rendered on a tracked-card row.
 * - Click to bump +1; Shift+click to bump -1 (only when editable).
 * - Renders as a non-interactive span when editable=false.
 */

interface CounterBadgeProps {
  type: CounterKey
  count: number
  editable: boolean
  onChange?: (delta: number) => void
}

export function CounterBadge({
  type,
  count,
  editable,
  onChange,
}: CounterBadgeProps) {
  const meta = COUNTER_META[type]
  const Icon = meta.icon
  const className = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.badgeClass} ${editable ? 'cursor-pointer hover:brightness-125' : ''}`
  const ariaLabel = `${meta.label}: ${count}`
  if (!editable) {
    return (
      <span className={className} aria-label={ariaLabel}>
        <Icon className="h-3 w-3" />
        {count}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={(event) => onChange?.(event.shiftKey ? -1 : 1)}
    >
      <Icon className="h-3 w-3" />
      {count}
    </button>
  )
}
