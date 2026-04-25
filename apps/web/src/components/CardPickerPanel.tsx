/**
 * Top-K picker rendered when recognition is low confidence.
 * Lets the user one-tap the right card from the consensus alternatives.
 */
import type { CardQueryAlternative } from '@/types/card-query'

interface CardPickerPanelProps {
  alternatives: CardQueryAlternative[]
  selectedScryfallId?: string
  onSelect: (alt: CardQueryAlternative) => void
  ocrText?: string
}

const ART = (id: string) =>
  `https://api.scryfall.com/cards/${id}?format=image&version=art_crop`

export function CardPickerPanel({
  alternatives,
  selectedScryfallId,
  onSelect,
  ocrText,
}: CardPickerPanelProps) {
  if (alternatives.length === 0) return null
  return (
    <div
      data-testid="card-picker-panel"
      className="p-2 rounded-lg border border-warning/40 bg-warning/5"
    >
      <div className="mb-1 text-xs font-medium text-warning">
        Low confidence — pick the right card
      </div>
      {ocrText ? (
        <div className="mb-2 text-[11px] text-text-muted italic">
          OCR: &ldquo;{ocrText}&rdquo;
        </div>
      ) : null}
      <div className="space-y-1">
        {alternatives.slice(0, 5).map((alt) => {
          const selected = alt.scryfallId === selectedScryfallId
          return (
            <button
              key={alt.scryfallId}
              type="button"
              onClick={() => onSelect(alt)}
              className={`gap-2 p-1.5 flex w-full items-center rounded-md text-left transition ${selected ? 'bg-brand/30' : 'hover:bg-surface-2/60'}`}
            >
              <img
                src={ART(alt.scryfallId)}
                alt=""
                className="h-10 w-14 rounded object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">
                  {alt.name}
                </div>
                <div className="text-[11px] text-text-muted uppercase">
                  {alt.set} · {(alt.score * 100).toFixed(0)}% · {alt.source}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
