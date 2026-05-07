import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Skeleton } from '@repo/ui/components/skeleton'

// ── Types ────────────────────────────────────────────────────────────────────

interface ScryfallCard {
  name: string
  mana_cost: string
  type_line: string
  oracle_text: string
  power?: string
  toughness?: string
  loyalty?: string
  set_name: string
  rarity: string
  image_uris?: { normal: string; small: string }
  card_faces?: Array<{ image_uris?: { normal: string } }>
  scryfall_uri: string
}

interface CardDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cardName: string
  scryfallId?: string
  onRemove?: () => void
}

// ── Module-level cache ───────────────────────────────────────────────────────

const cardCache = new Map<string, ScryfallCard>()

// ── Mana cost rendering ──────────────────────────────────────────────────────

const MANA_SYMBOL_RE = /\{([^}]+)\}/g

function ManaCost({ cost }: { cost: string }) {
  if (!cost) return null

  const symbols = Array.from(cost.matchAll(MANA_SYMBOL_RE), (m) => m[1] ?? '')
    .filter(Boolean)

  if (symbols.length === 0) return null

  return (
    <span className="gap-0.5 inline-flex items-center">
      {symbols.map((symbol, i) => (
        <img
          key={`${symbol}-${i}`}
          src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(symbol)}.svg`}
          alt={`{${symbol}}`}
          className="inline-block h-5 w-5"
          loading="lazy"
        />
      ))}
    </span>
  )
}

// ── Oracle text with inline mana symbols ─────────────────────────────────────

function OracleText({ text }: { text: string }) {
  if (!text) return null

  // Split on mana symbols, keeping the delimiters
  const parts = text.split(/(\{[^}]+\})/)

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
      {parts.map((part, i) => {
        const symbolMatch = /^\{([^}]+)\}$/.exec(part)
        if (symbolMatch) {
          const symbol = symbolMatch[1] ?? ''
          return (
            <img
              key={i}
              src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(symbol)}.svg`}
              alt={part}
              className="mb-0.5 inline-block h-4 w-4 align-text-bottom"
              loading="lazy"
            />
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function CardDetailModal({
  open,
  onOpenChange,
  cardName,
  scryfallId: _scryfallId,
  onRemove,
}: CardDetailModalProps) {
  const [card, setCard] = useState<ScryfallCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCard = useCallback(async (name: string) => {
    if (!name) return

    // Check cache first
    const cached = cardCache.get(name)
    if (cached) {
      setCard(cached)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
      )

      if (res.status === 404) {
        setError('Card not found')
        setCard(null)
        return
      }

      if (!res.ok) {
        setError('Failed to load card details')
        setCard(null)
        return
      }

      const data = (await res.json()) as ScryfallCard

      cardCache.set(name, data)
      setCard(data)
    } catch {
      setError('Network error')
      setCard(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && cardName) {
      fetchCard(cardName)
    }
    if (!open) {
      // Reset state when closing so stale data doesn't flash on next open
      setCard(null)
      setError(null)
    }
  }, [open, cardName, fetchCard])

  // Resolve image URL — handle double-faced cards
  const imageUrl =
    card?.image_uris?.normal ??
    card?.card_faces?.[0]?.image_uris?.normal ??
    null

  const rarityColor: Record<string, string> = {
    common: 'text-zinc-400',
    uncommon: 'text-gray-300',
    rare: 'text-amber-400',
    mythic: 'text-orange-500',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px] border-surface-2 bg-surface-1">
        <DialogHeader className="sr-only">
          <DialogTitle>{cardName}</DialogTitle>
        </DialogHeader>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4 p-5">
            <Skeleton className="mx-auto h-[340px] w-[245px] rounded-xl bg-surface-2" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-3/4 bg-surface-2" />
              <Skeleton className="h-4 w-1/2 bg-surface-2" />
              <Skeleton className="h-20 w-full bg-surface-2" />
            </div>
          </div>
        )}

        {/* 404 / error */}
        {!loading && error && (
          <div className="gap-2 p-10 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-text-muted">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="mt-2 border-surface-2 text-text-secondary"
            >
              Close
            </Button>
          </div>
        )}

        {/* Card detail */}
        {!loading && !error && card && (
          <div className="flex flex-col">
            {/* Card image */}
            {imageUrl && (
              <div className="bg-surface-2">
                <img
                  src={imageUrl}
                  alt={card.name}
                  className="mx-auto h-auto w-full max-w-[320px] py-4"
                />
              </div>
            )}

            {/* Card info */}
            <div className="space-y-3 p-5">
              {/* Name + mana cost */}
              <div className="gap-2 flex items-start justify-between">
                <h2 className="text-lg font-bold text-white">{card.name}</h2>
                <ManaCost cost={card.mana_cost} />
              </div>

              {/* Type line */}
              <p className="text-sm font-medium text-text-secondary">
                {card.type_line}
              </p>

              {/* Oracle text */}
              {card.oracle_text && (
                <div className="rounded-lg border border-surface-2 bg-surface-2/50 p-3">
                  <OracleText text={card.oracle_text} />
                </div>
              )}

              {/* Power/toughness or loyalty */}
              {card.power != null && card.toughness != null && (
                <p className="text-sm font-semibold text-white">
                  {card.power} / {card.toughness}
                </p>
              )}
              {card.loyalty != null && (
                <p className="text-sm font-semibold text-white">
                  Loyalty: {card.loyalty}
                </p>
              )}

              {/* Set + rarity */}
              <p className="text-xs text-text-muted">
                {card.set_name}
                {' · '}
                <span
                  className={
                    rarityColor[card.rarity.toLowerCase()] ?? 'text-text-muted'
                  }
                >
                  {card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)}
                </span>
              </p>

              {/* Actions row */}
              <div className="gap-2 pt-1 flex items-center">
                <a
                  href={card.scryfall_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-1 rounded-md border border-surface-2 bg-surface-2 px-3 py-1.5 text-xs font-medium hover:text-white inline-flex items-center text-text-secondary transition-colors hover:bg-surface-2/80"
                >
                  Scryfall
                  <ExternalLink className="h-3 w-3" />
                </a>

                {onRemove && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onRemove()
                      onOpenChange(false)
                    }}
                    className="gap-1 ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove from Battlefield
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
