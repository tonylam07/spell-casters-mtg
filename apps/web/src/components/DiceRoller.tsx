import { useCallback, useState } from 'react'
import { api } from '@convex/_generated/api'
import { useMutation } from 'convex/react'
import { Dices } from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@repo/ui/components/popover'

type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'coin'

interface DieResult {
  die: DieType
  result: number
  sides: number
}

const DICE: Array<{ die: DieType; label: string; color: string }> = [
  { die: 'd4', label: 'D4', color: 'text-emerald-400 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10' },
  { die: 'd6', label: 'D6', color: 'text-sky-400 border-sky-500/30 hover:border-sky-500/60 hover:bg-sky-500/10' },
  { die: 'd8', label: 'D8', color: 'text-violet-400 border-violet-500/30 hover:border-violet-500/60 hover:bg-violet-500/10' },
  { die: 'd10', label: 'D10', color: 'text-amber-400 border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/10' },
  { die: 'd12', label: 'D12', color: 'text-rose-400 border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/10' },
  { die: 'd20', label: 'D20', color: 'text-brand-muted-foreground border-brand/30 hover:border-brand/60 hover:bg-brand/10' },
  { die: 'coin', label: '🪙', color: 'text-yellow-400 border-yellow-500/30 hover:border-yellow-500/60 hover:bg-yellow-500/10' },
]

function formatResult(result: DieResult): string {
  if (result.die === 'coin') return result.result === 1 ? 'Heads' : 'Tails'
  return String(result.result)
}

function isCritical(result: DieResult): boolean {
  return result.die !== 'coin' && result.result === result.sides
}

function isFumble(result: DieResult): boolean {
  return result.die !== 'coin' && result.result === 1
}

interface DiceRollerProps {
  roomId: string
}

export function DiceRoller({ roomId }: DiceRollerProps) {
  const rollDice = useMutation(api.gameEvents.rollDice)
  const [lastResult, setLastResult] = useState<DieResult | null>(null)
  const [rolling, setRolling] = useState(false)
  const [open, setOpen] = useState(false)

  const handleRoll = useCallback(
    async (die: DieType) => {
      if (rolling) return
      setRolling(true)
      try {
        const result = await rollDice({ roomId, die })
        const sides = die === 'coin' ? 2 : parseInt(die.slice(1), 10)
        setLastResult({ die, result: result as number, sides })
      } finally {
        setRolling(false)
      }
    },
    [rollDice, roomId, rolling],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 border-surface-3 text-text-secondary hover:text-text-primary"
          title="Dice roller"
        >
          <Dices className="h-3.5 w-3.5" />
          {lastResult ? (
            <span
              className={`text-xs font-mono ${
                isCritical(lastResult)
                  ? 'text-emerald-400'
                  : isFumble(lastResult)
                    ? 'text-destructive'
                    : 'text-text-secondary'
              }`}
            >
              {formatResult(lastResult)}
            </span>
          ) : (
            <span className="text-xs">Roll</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3 border-surface-2 bg-surface-1"
        align="end"
        sideOffset={4}
      >
        <div className="space-y-3">
          <p className="text-xs font-medium text-text-muted">Roll a die</p>
          <div className="grid grid-cols-4 gap-1.5">
            {DICE.map(({ die, label, color }) => (
              <button
                key={die}
                disabled={rolling}
                onClick={() => void handleRoll(die)}
                className={`h-10 flex items-center justify-center rounded-md border text-xs font-bold transition-all disabled:opacity-50 ${color}`}
              >
                {label}
              </button>
            ))}
          </div>
          {lastResult && (
            <div className="pt-1 border-t border-surface-2">
              <p className="text-xs text-text-muted">Last roll</p>
              <p
                className={`text-lg font-bold tabular-nums ${
                  isCritical(lastResult)
                    ? 'text-emerald-400'
                    : isFumble(lastResult)
                      ? 'text-destructive'
                      : 'text-text-primary'
                }`}
              >
                {formatResult(lastResult)}
                {isCritical(lastResult) && (
                  <span className="ml-1.5 text-xs font-normal text-emerald-400">
                    Critical!
                  </span>
                )}
                {isFumble(lastResult) && (
                  <span className="ml-1.5 text-xs font-normal text-destructive">
                    Fumble
                  </span>
                )}
              </p>
              <p className="text-xs text-text-muted">
                {lastResult.die === 'coin' ? 'Coin flip' : lastResult.die.toUpperCase()} · rolled by you
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
