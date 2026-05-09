import { useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs'
import { Textarea } from '@repo/ui/components/textarea'

import type { DeckCard, ResolvedDeckCard } from '@/lib/deck-parsers'
import {
  parseArchidekt,
  parseMoxfield,
  parsePlainText,
  resolveWithScryfall,
} from '@/lib/deck-parsers'

interface DeckImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (args: {
    name: string
    source: string
    sourceUrl?: string
    cards: Array<{
      scryfallId: string
      name: string
      quantity: number
      section: string
    }>
  }) => Promise<unknown>
}

type ImportState =
  | { step: 'input' }
  | { step: 'loading'; message: string }
  | {
      step: 'preview'
      name: string
      source: string
      sourceUrl?: string
      resolved: ResolvedDeckCard[]
      unresolved: DeckCard[]
    }

export function DeckImportDialog({
  open,
  onOpenChange,
  onImport,
}: DeckImportDialogProps) {
  const [state, setState] = useState<ImportState>({ step: 'input' })
  const [moxfieldUrl, setMoxfieldUrl] = useState('')
  const [archidektUrl, setArchidektUrl] = useState('')
  const [textInput, setTextInput] = useState('')

  const reset = () => {
    setState({ step: 'input' })
    setMoxfieldUrl('')
    setArchidektUrl('')
    setTextInput('')
  }

  const handleParse = async (
    parseFn: () => Promise<Awaited<ReturnType<typeof parseMoxfield>>>,
    source: string,
    sourceUrl?: string,
  ) => {
    setState({ step: 'loading', message: 'Fetching decklist...' })
    try {
      const parsed = await parseFn()
      setState({ step: 'loading', message: 'Resolving cards with Scryfall...' })
      const { resolved, unresolved } = await resolveWithScryfall(parsed.cards)
      setState({
        step: 'preview',
        name: parsed.name,
        source,
        sourceUrl,
        resolved,
        unresolved,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      toast.error(message)
      setState({ step: 'input' })
    }
  }

  const handleConfirmImport = async () => {
    if (state.step !== 'preview') return
    setState({ step: 'loading', message: 'Importing deck...' })
    try {
      await onImport({
        name: state.name,
        source: state.source,
        sourceUrl: state.sourceUrl,
        cards: state.resolved.map((c) => ({
          scryfallId: c.scryfallId,
          name: c.name,
          quantity: c.quantity,
          section: c.section,
        })),
      })
      toast.success(`Deck "${state.name}" imported!`)
      reset()
      onOpenChange(false)
    } catch {
      toast.error('Failed to import deck')
      setState({ step: 'input' })
    }
  }

  const totalCards =
    state.step === 'preview'
      ? state.resolved.reduce((sum, c) => sum + c.quantity, 0)
      : 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-[480px] border-surface-2 bg-surface-1">
        <DialogHeader>
          <DialogTitle className="text-white">Load Deck</DialogTitle>
        </DialogHeader>

        {state.step === 'loading' && (
          <div className="gap-3 py-8 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <p className="text-sm text-text-muted">{state.message}</p>
          </div>
        )}

        {state.step === 'input' && (
          <Tabs defaultValue="moxfield" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-surface-2">
              <TabsTrigger value="moxfield">Moxfield</TabsTrigger>
              <TabsTrigger value="archidekt">Archidekt</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
            </TabsList>

            <TabsContent value="moxfield" className="space-y-3 pt-2">
              <Input
                placeholder="https://www.moxfield.com/decks/..."
                value={moxfieldUrl}
                onChange={(e) => setMoxfieldUrl(e.target.value)}
                className="border-surface-2 bg-surface-0 text-white"
              />
              <Button
                onClick={() =>
                  handleParse(() => parseMoxfield(moxfieldUrl), 'moxfield', moxfieldUrl)
                }
                disabled={!moxfieldUrl.trim()}
                className="w-full bg-brand text-white hover:bg-brand/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Load from Moxfield
              </Button>
            </TabsContent>

            <TabsContent value="archidekt" className="space-y-3 pt-2">
              <Input
                placeholder="https://archidekt.com/decks/..."
                value={archidektUrl}
                onChange={(e) => setArchidektUrl(e.target.value)}
                className="border-surface-2 bg-surface-0 text-white"
              />
              <Button
                onClick={() =>
                  handleParse(() => parseArchidekt(archidektUrl), 'archidekt', archidektUrl)
                }
                disabled={!archidektUrl.trim()}
                className="w-full bg-brand text-white hover:bg-brand/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Load from Archidekt
              </Button>
            </TabsContent>

            <TabsContent value="text" className="space-y-3 pt-2">
              <Textarea
                placeholder={"4 Lightning Bolt\n2 Counterspell\n// Sideboard\n2 Rest in Peace"}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="min-h-[160px] border-surface-2 bg-surface-0 font-mono text-sm text-white"
              />
              <Button
                onClick={() =>
                  handleParse(async () => parsePlainText(textInput), 'text')
                }
                disabled={!textInput.trim()}
                className="w-full bg-brand text-white hover:bg-brand/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Load from Text
              </Button>
            </TabsContent>
          </Tabs>
        )}

        {state.step === 'preview' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-white">{state.name}</h3>
              <p className="text-sm text-text-muted">
                {totalCards} cards · {state.resolved.length} unique ·{' '}
                {state.source}
              </p>
            </div>

            {state.unresolved.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
                <p className="mb-1 text-xs font-medium text-warning">
                  {state.unresolved.length} card(s) not found:
                </p>
                <ul className="space-y-0.5 text-xs text-text-muted">
                  {state.unresolved.map((card) => (
                    <li key={card.name}>• {card.name}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="max-h-48 overflow-y-auto rounded-md border border-surface-2 bg-surface-0 p-2">
              {state.resolved.map((card, i) => (
                <div
                  key={`${card.name}-${i}`}
                  className="px-2 py-0.5 flex items-center justify-between text-xs"
                >
                  <span className="text-text-secondary">
                    {card.quantity}x {card.name}
                  </span>
                  <span className="text-text-muted">{card.section}</span>
                </div>
              ))}
            </div>

            <div className="gap-2 flex">
              <Button
                onClick={handleConfirmImport}
                className="flex-1 bg-brand text-white hover:bg-brand/90"
              >
                Import Deck
              </Button>
              <Button
                variant="outline"
                onClick={reset}
                className="border-surface-2 text-text-muted"
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
