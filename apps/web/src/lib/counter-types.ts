/**
 * Card-counter catalog for Commander format.
 * Keys must match the trackedCards.counters object keys in convex/schema.ts.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Crown,
  Hourglass,
  Minus,
  Plus,
  ScrollText,
  Shield as ShieldIcon,
  Snowflake,
  Zap,
} from 'lucide-react'

export const COUNTER_KEYS = [
  'plus1plus1',
  'minus1minus1',
  'loyalty',
  'charge',
  'stun',
  'shield',
  'quest',
  'time',
] as const

export type CounterKey = (typeof COUNTER_KEYS)[number]

export interface CounterMeta {
  key: CounterKey
  label: string
  /** Tailwind classes for the badge background/border/text */
  badgeClass: string
  icon: LucideIcon
}

export const COUNTER_META: Record<CounterKey, CounterMeta> = {
  plus1plus1: {
    key: 'plus1plus1',
    label: '+1/+1',
    badgeClass: 'bg-green-600/30 text-green-200 border-green-600/50',
    icon: Plus,
  },
  minus1minus1: {
    key: 'minus1minus1',
    label: '-1/-1',
    badgeClass: 'bg-red-600/30 text-red-200 border-red-600/50',
    icon: Minus,
  },
  loyalty: {
    key: 'loyalty',
    label: 'Loyalty',
    badgeClass: 'bg-indigo-600/30 text-indigo-200 border-indigo-600/50',
    icon: Crown,
  },
  charge: {
    key: 'charge',
    label: 'Charge',
    badgeClass: 'bg-amber-500/30 text-amber-200 border-amber-500/50',
    icon: Zap,
  },
  stun: {
    key: 'stun',
    label: 'Stun',
    badgeClass: 'bg-sky-600/30 text-sky-200 border-sky-600/50',
    icon: Snowflake,
  },
  shield: {
    key: 'shield',
    label: 'Shield',
    badgeClass: 'bg-slate-500/30 text-slate-200 border-slate-500/50',
    icon: ShieldIcon,
  },
  quest: {
    key: 'quest',
    label: 'Quest',
    badgeClass: 'bg-purple-600/30 text-purple-200 border-purple-600/50',
    icon: ScrollText,
  },
  time: {
    key: 'time',
    label: 'Time',
    badgeClass: 'bg-rose-500/30 text-rose-200 border-rose-500/50',
    icon: Hourglass,
  },
}

export type CounterMap = Partial<Record<CounterKey, number>>

/** Number of distinct non-zero counter types in a map */
export function counterTypeCount(map: CounterMap): number {
  return COUNTER_KEYS.reduce(
    (acc, key) => acc + ((map[key] ?? 0) > 0 ? 1 : 0),
    0,
  )
}
