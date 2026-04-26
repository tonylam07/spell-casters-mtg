# Recognition Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement docs/superpowers/specs/2026-04-25-recognition-accuracy-design.md — title-bar OCR + multi-frame consensus + top-K picker UI. Together: closes most of the accuracy gap to TCGAutomate without changing the underlying CLIP model.

**Architecture:** Three independent client-side modules wired into the existing `useCardQuery` pipeline: an OCR worker for title-bar text extraction, a fusion layer combining CLIP and OCR signals, and a rolling-buffer consensus voter. UI surfaces low-confidence results via a top-K picker rendered inline in the existing CardPreview sidebar slot.

**Tech Stack:** Tesseract.js (English LSTM model), Web Workers, existing OpenCV/CLIP pipeline (no model changes), Vitest for unit tests, Playwright for E2E.

---

## File Structure

**Create:**
- `apps/web/src/lib/title-ocr.ts` — Tesseract.js setup + worker, `runTitleOcr(canvas) → { text, confidence }`
- `apps/web/src/lib/title-ocr.worker.ts` — actual worker (Tesseract runs here)
- `apps/web/src/lib/scryfall-name-index.ts` — in-memory name → scryfall card map built from existing card-metadata
- `apps/web/src/lib/recognition-fusion.ts` — `fuse(clipTopK, ocrText) → rankedCandidate[]`
- `apps/web/src/lib/frame-consensus.ts` — `FrameConsensusBuffer` class with `push()`, `consensus()`, `clear()`
- `apps/web/src/components/CardPickerPanel.tsx` — top-K picker rendered in CardPreview slot
- `apps/web/src/lib/__tests__/recognition-fusion.test.ts`
- `apps/web/src/lib/__tests__/frame-consensus.test.ts`
- `apps/web/src/lib/__tests__/scryfall-name-index.test.ts`

**Modify:**
- `apps/web/src/types/card-query.ts` — add `RankedCandidate`, extend `CardQueryState` with `alternatives: RankedCandidate[]`
- `apps/web/src/hooks/useCardQuery.ts` — wire OCR call, fusion, consensus buffer, alternatives in state
- `apps/web/src/components/CardPreview.tsx` — render `CardPickerPanel` when alternatives present + top score < 0.85
- `apps/web/src/components/LocalVideoCard.tsx` — clear consensus buffer when user clicks the tile (manual reset)

---

## Task 1: Scryfall name index

**Files:**
- Create: `apps/web/src/lib/scryfall-name-index.ts`
- Test: `apps/web/src/lib/__tests__/scryfall-name-index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildNameIndex, lookupName } from '../scryfall-name-index'

describe('scryfall-name-index', () => {
  const cards = [
    { name: 'Sol Ring', scryfallId: 'a', set: 'cmd' },
    { name: 'Sol Ring', scryfallId: 'b', set: 'lea' },
    { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea' },
    { name: "Wear // Tear", scryfallId: 'd', set: 'dgm' },
  ]
  const index = buildNameIndex(cards)

  it('exact-matches case-insensitively, ignoring punctuation', () => {
    expect(lookupName(index, 'sol ring')).toHaveLength(2)
    expect(lookupName(index, 'SOL RING')).toHaveLength(2)
    expect(lookupName(index, 'lightning  bolt')).toHaveLength(1)
  })

  it('matches double-faced/split card names by either side', () => {
    expect(lookupName(index, 'wear')[0]?.scryfallId).toBe('d')
    expect(lookupName(index, 'tear')[0]?.scryfallId).toBe('d')
  })

  it('returns [] for noise', () => {
    expect(lookupName(index, '@@@!!!')).toEqual([])
    expect(lookupName(index, '')).toEqual([])
  })

  it('fuzzy-matches single-character OCR errors (edit distance ≤ 2)', () => {
    expect(lookupName(index, 'S0l Ring')).toHaveLength(2) // 0/o swap
    expect(lookupName(index, 'Lightening Bolt')).toHaveLength(1) // 'e' insertion
  })
})
```

- [ ] **Step 2: Run + verify fail**

```bash
bun --cwd apps/web vitest run src/lib/__tests__/scryfall-name-index.test.ts
```

Expected: cannot find module.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/scryfall-name-index.ts
export interface CardEntry { name: string; scryfallId: string; set: string }
export interface NameIndex {
  exact: Map<string, CardEntry[]>     // normalized name → entries
  allNames: string[]                  // for fuzzy candidates
  byNormalized: Map<string, CardEntry[]>
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
}

/** Levenshtein with early-exit if distance > maxDist */
function editDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]
    dp[0] = j
    let rowMin = dp[0]
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]
      dp[i] = a[i-1] === b[j-1]
        ? prev
        : Math.min(prev, dp[i], dp[i-1]) + 1
      prev = tmp
      if (dp[i] < rowMin) rowMin = dp[i]
    }
    if (rowMin > maxDist) return maxDist + 1
  }
  return dp[a.length]
}

export function buildNameIndex(cards: CardEntry[]): NameIndex {
  const exact = new Map<string, CardEntry[]>()
  const byNormalized = new Map<string, CardEntry[]>()
  for (const c of cards) {
    // Index full name + each side of split/DFC names
    const sides = c.name.split(/\s*\/\/\s*/).concat([c.name])
    for (const side of sides) {
      const norm = normalize(side)
      if (!norm) continue
      const arr = byNormalized.get(norm) ?? []
      arr.push(c)
      byNormalized.set(norm, arr)
    }
  }
  return { exact, allNames: Array.from(byNormalized.keys()), byNormalized }
}

export function lookupName(index: NameIndex, query: string): CardEntry[] {
  const norm = normalize(query)
  if (!norm) return []
  const exactHit = index.byNormalized.get(norm)
  if (exactHit && exactHit.length) return exactHit
  // Fuzzy fallback
  const maxDist = norm.length <= 5 ? 1 : 2
  let bestDist = maxDist + 1
  let bestEntries: CardEntry[] = []
  for (const candidate of index.allNames) {
    const d = editDistance(norm, candidate, maxDist)
    if (d < bestDist) {
      bestDist = d
      bestEntries = index.byNormalized.get(candidate) ?? []
      if (bestDist === 0) break
    }
  }
  return bestEntries
}
```

- [ ] **Step 4: Run + verify pass**

```bash
bun --cwd apps/web vitest run src/lib/__tests__/scryfall-name-index.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/scryfall-name-index.ts apps/web/src/lib/__tests__/scryfall-name-index.test.ts
git commit -m "feat(recognition): scryfall name index with fuzzy lookup"
```

---

## Task 2: Title-bar OCR (Tesseract.js worker)

**Files:**
- Create: `apps/web/src/lib/title-ocr.ts`

- [ ] **Step 1: Add Tesseract dep**

```bash
bun add --filter @repo/web tesseract.js@^5
```

- [ ] **Step 2: Implement title OCR**

```ts
// apps/web/src/lib/title-ocr.ts
import { createWorker, type Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker('eng', 1, {
        // Use the LSTM-only engine; faster than legacy + LSTM combo
      })
      // Whitelist alphanumeric + common card-name punctuation
      await w.setParameters({
        tessedit_char_whitelist:
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,.-\'',
      })
      return w
    })()
  }
  return workerPromise
}

export interface TitleOcrResult {
  text: string
  confidence: number
  /** ms spent in OCR */
  durationMs: number
}

/**
 * Run OCR on the top ~10% of the warped card crop.
 * Caller passes a canvas containing the FULL warped card; we extract the title strip.
 */
export async function runTitleOcr(cardCanvas: HTMLCanvasElement): Promise<TitleOcrResult> {
  const start = performance.now()
  // Title bar is approx the top ~10% (slightly less to skip the very edge)
  const titleH = Math.round(cardCanvas.height * 0.11)
  const titleY = Math.round(cardCanvas.height * 0.02)
  const titleStrip = document.createElement('canvas')
  titleStrip.width = cardCanvas.width
  titleStrip.height = titleH
  const ctx = titleStrip.getContext('2d')!
  ctx.drawImage(cardCanvas, 0, titleY, cardCanvas.width, titleH, 0, 0, cardCanvas.width, titleH)

  // Optional: simple contrast bump to help on low-light cards
  const img = ctx.getImageData(0, 0, titleStrip.width, titleStrip.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i+1] + d[i+2]) / 3
    const enhanced = v > 128 ? 255 : 0  // hard threshold; titles are high-contrast
    d[i] = d[i+1] = d[i+2] = enhanced
  }
  ctx.putImageData(img, 0, 0)

  const w = await getWorker()
  const { data } = await w.recognize(titleStrip)
  return {
    text: data.text.trim(),
    confidence: data.confidence / 100,
    durationMs: performance.now() - start,
  }
}

/** Optional cleanup, e.g. on route teardown */
export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
```

> **Note for implementer:** Tesseract.js spawns its own Web Worker internally; we don't need a separate one. The `createWorker('eng', 1, ...)` call lazy-loads the eng.traineddata model (~5MB) on first call.

- [ ] **Step 3: Smoke test in browser**

```bash
bun run --cwd apps/web dev
```

Open the recognition flow, verify OCR runs without errors and the model loads on first detection.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/title-ocr.ts apps/web/package.json bun.lockb
git commit -m "feat(recognition): title-bar OCR via Tesseract.js"
```

---

## Task 3: Recognition fusion

**Files:**
- Create: `apps/web/src/lib/recognition-fusion.ts`
- Test: `apps/web/src/lib/__tests__/recognition-fusion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { fuse } from '../recognition-fusion'
import { buildNameIndex } from '../scryfall-name-index'

const index = buildNameIndex([
  { name: 'Sol Ring', scryfallId: 'a', set: 'cmd' },
  { name: 'Sol Ring', scryfallId: 'b', set: 'lea' },
  { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea' },
])

describe('fuse', () => {
  it('promotes the OCR-matched card to top with high confidence', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.6 },
      { name: 'Sol Ring', scryfallId: 'a', set: 'cmd', score: 0.55 },
    ]
    const fused = fuse(clipTopK, 'Sol Ring', 0.9, index)
    expect(fused[0].card.name).toBe('Sol Ring')
    expect(fused[0].score).toBeGreaterThan(0.95)
    expect(fused[0].source).toBe('ocr+clip')
  })

  it('falls back to CLIP when OCR is empty', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.8 },
    ]
    const fused = fuse(clipTopK, '', 0, index)
    expect(fused[0].card.name).toBe('Lightning Bolt')
    expect(fused[0].source).toBe('clip')
  })

  it('falls back to CLIP when OCR has no matches', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.8 },
    ]
    const fused = fuse(clipTopK, 'completely unknown card name', 0.9, index)
    expect(fused[0].source).toBe('clip')
  })
})
```

- [ ] **Step 2: Run + verify fail**

```bash
bun --cwd apps/web vitest run src/lib/__tests__/recognition-fusion.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/recognition-fusion.ts
import type { CardEntry, NameIndex } from './scryfall-name-index'
import { lookupName } from './scryfall-name-index'

export interface ClipResult {
  name: string
  scryfallId: string
  set: string
  score: number
}

export type CandidateSource = 'clip' | 'ocr+clip' | 'ocr-only'

export interface RankedCandidate {
  card: ClipResult | CardEntry
  score: number
  source: CandidateSource
}

const OCR_MIN_CONFIDENCE = 0.5
const OCR_BOOST_SCORE = 0.99

export function fuse(
  clipTopK: ClipResult[],
  ocrText: string,
  ocrConfidence: number,
  nameIndex: NameIndex,
): RankedCandidate[] {
  if (!ocrText.trim() || ocrConfidence < OCR_MIN_CONFIDENCE) {
    return clipTopK.map((c) => ({ card: c, score: c.score, source: 'clip' }))
  }
  const matches = lookupName(nameIndex, ocrText)
  if (matches.length === 0) {
    return clipTopK.map((c) => ({ card: c, score: c.score, source: 'clip' }))
  }
  const matchedNames = new Set(matches.map((m) => m.name))
  // Promote CLIP results that match the OCR'd name
  const promoted: RankedCandidate[] = []
  const remaining: RankedCandidate[] = []
  for (const c of clipTopK) {
    if (matchedNames.has(c.name)) {
      promoted.push({ card: c, score: OCR_BOOST_SCORE, source: 'ocr+clip' })
    } else {
      remaining.push({ card: c, score: c.score, source: 'clip' })
    }
  }
  // If CLIP didn't surface ANY printing of the OCR'd card, fall back to the
  // first scryfall match for each name (we won't have a thumbnail score).
  if (promoted.length === 0) {
    for (const m of matches) {
      promoted.push({ card: m, score: 0.85, source: 'ocr-only' })
    }
  }
  return [...promoted, ...remaining]
}
```

- [ ] **Step 4: Run + verify pass**

```bash
bun --cwd apps/web vitest run src/lib/__tests__/recognition-fusion.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/recognition-fusion.ts apps/web/src/lib/__tests__/recognition-fusion.test.ts
git commit -m "feat(recognition): fuse CLIP top-K with OCR name match"
```

---

## Task 4: Frame consensus buffer

**Files:**
- Create: `apps/web/src/lib/frame-consensus.ts`
- Test: `apps/web/src/lib/__tests__/frame-consensus.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, it } from 'vitest'
import { FrameConsensusBuffer } from '../frame-consensus'

const c = (id: string, score: number, source: 'clip' | 'ocr+clip' = 'clip') => ({
  card: { name: id, scryfallId: id, set: 'x', score },
  score,
  source,
})

describe('FrameConsensusBuffer', () => {
  it('returns the latest frame when buffer < 2 frames', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    b.push([c('a', 0.7), c('b', 0.5)])
    expect(b.consensus().top?.card.scryfallId).toBe('a')
  })

  it('votes by squared score across multiple frames', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    // Frame 1: a wins
    b.push([c('a', 0.6), c('b', 0.55)])
    // Frame 2: b wins big
    b.push([c('b', 0.95), c('a', 0.4)])
    // Frame 3: b again
    b.push([c('b', 0.8), c('c', 0.3)])
    expect(b.consensus().top?.card.scryfallId).toBe('b')
  })

  it('exposes top-N alternatives', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    b.push([c('a', 0.9), c('b', 0.7), c('c', 0.5)])
    b.push([c('a', 0.85), c('b', 0.65), c('c', 0.45)])
    const result = b.consensus()
    expect(result.alternatives.map((a) => a.card.scryfallId)).toEqual(['a', 'b', 'c'])
  })

  it('clear() empties the buffer', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    b.push([c('a', 0.9)])
    b.clear()
    expect(b.consensus().top).toBeNull()
  })
})
```

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/frame-consensus.ts
import type { RankedCandidate } from './recognition-fusion'

interface Frame {
  candidates: RankedCandidate[]
  timestamp: number
}

export interface ConsensusResult {
  top: RankedCandidate | null
  alternatives: RankedCandidate[]   // up to 5, including top
  frameCount: number
}

interface BufferOptions {
  size: number
  maxAgeMs?: number
  topNPerFrame?: number
  topNAlternatives?: number
}

export class FrameConsensusBuffer {
  private frames: Frame[] = []
  private readonly size: number
  private readonly maxAgeMs: number
  private readonly topNPerFrame: number
  private readonly topNAlternatives: number

  constructor(opts: BufferOptions) {
    this.size = opts.size
    this.maxAgeMs = opts.maxAgeMs ?? 5000
    this.topNPerFrame = opts.topNPerFrame ?? 3
    this.topNAlternatives = opts.topNAlternatives ?? 5
  }

  push(candidates: RankedCandidate[]): void {
    this.frames.push({ candidates, timestamp: Date.now() })
    if (this.frames.length > this.size) this.frames.shift()
  }

  clear(): void {
    this.frames = []
  }

  consensus(): ConsensusResult {
    const now = Date.now()
    this.frames = this.frames.filter((f) => now - f.timestamp <= this.maxAgeMs)

    if (this.frames.length === 0) {
      return { top: null, alternatives: [], frameCount: 0 }
    }
    if (this.frames.length === 1) {
      const top = this.frames[0].candidates[0] ?? null
      return {
        top,
        alternatives: this.frames[0].candidates.slice(0, this.topNAlternatives),
        frameCount: 1,
      }
    }

    // Tally squared scores
    const tally = new Map<string, { sum: number; latest: RankedCandidate }>()
    for (const frame of this.frames) {
      for (const cand of frame.candidates.slice(0, this.topNPerFrame)) {
        const id = cand.card.scryfallId
        const prior = tally.get(id) ?? { sum: 0, latest: cand }
        tally.set(id, {
          sum: prior.sum + cand.score * cand.score,
          latest: cand,
        })
      }
    }
    const ranked = Array.from(tally.values())
      .sort((a, b) => b.sum - a.sum)
      .map((x) => x.latest)
    return {
      top: ranked[0] ?? null,
      alternatives: ranked.slice(0, this.topNAlternatives),
      frameCount: this.frames.length,
    }
  }
}
```

- [ ] **Step 3: Run + verify pass**

```bash
bun --cwd apps/web vitest run src/lib/__tests__/frame-consensus.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/frame-consensus.ts apps/web/src/lib/__tests__/frame-consensus.test.ts
git commit -m "feat(recognition): rolling-buffer frame consensus voter"
```

---

## Task 5: Wire OCR + fusion + consensus into useCardQuery

**Files:**
- Modify: `apps/web/src/types/card-query.ts`
- Modify: `apps/web/src/hooks/useCardQuery.ts`

- [ ] **Step 1: Extend types**

In `card-query.ts`, after `CardQueryResult`:

```ts
export interface CardQueryAlternative {
  scryfallId: string
  name: string
  set: string
  score: number
  source: 'clip' | 'ocr+clip' | 'ocr-only'
}
```

In `CardQueryState`, add:

```ts
alternatives: CardQueryAlternative[]
ocrText?: string
```

- [ ] **Step 2: Wire into useCardQuery**

In `useCardQuery.ts`:

1. Lazy-init `FrameConsensusBuffer({ size: 8 })` per hook instance.
2. Lazy-build `nameIndex` from the loaded card metadata once on first query.
3. Inside the query handler, after computing CLIP top-K (already done), kick off `runTitleOcr(winningCanvas)` in parallel with the existing CLIP pipeline. `Promise.all([clip, ocr])` — but wrap OCR in `.catch(() => empty)` so OCR failure never blocks CLIP.
4. Call `fuse(clipTopK, ocrResult.text, ocrResult.confidence, nameIndex)`.
5. Push fused candidates into the consensus buffer.
6. Read `consensus()` → use `top` as the winning result, push `alternatives` into state.

Pseudocode:

```ts
const [clipResult, ocrResult] = await Promise.all([
  runClipPipeline(winningCanvas),  // existing top1/topK logic
  runTitleOcr(winningCanvas).catch(() => ({ text: '', confidence: 0, durationMs: 0 })),
])

const nameIndex = await getOrBuildNameIndex()
const fused = fuse(clipResult.topK, ocrResult.text, ocrResult.confidence, nameIndex)
consensusBufferRef.current.push(fused)
const { top, alternatives } = consensusBufferRef.current.consensus()

setState({
  status: 'success',
  result: top ? toCardQueryResult(top) : null,
  alternatives: alternatives.map(toCardQueryAlternative),
  ocrText: ocrResult.text,
  // ...
})
```

- [ ] **Step 3: Typecheck + smoke test**

```bash
bun --cwd apps/web tsc --noEmit
bun run --cwd apps/web dev
```

Open recognition; verify alternatives populate in DevTools state.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types/card-query.ts apps/web/src/hooks/useCardQuery.ts
git commit -m "feat(recognition): wire OCR + fusion + consensus into useCardQuery"
```

---

## Task 6: CardPickerPanel UI

**Files:**
- Create: `apps/web/src/components/CardPickerPanel.tsx`
- Modify: `apps/web/src/components/CardPreview.tsx`

- [ ] **Step 1: Implement CardPickerPanel**

```tsx
// apps/web/src/components/CardPickerPanel.tsx
import type { CardQueryAlternative } from '@/types/card-query'

interface CardPickerPanelProps {
  alternatives: CardQueryAlternative[]
  selectedScryfallId?: string
  onSelect: (alt: CardQueryAlternative) => void
  ocrText?: string
}

const ART = (id: string) => `https://api.scryfall.com/cards/${id}?format=image&version=art_crop`

export function CardPickerPanel({ alternatives, selectedScryfallId, onSelect, ocrText }: CardPickerPanelProps) {
  if (alternatives.length === 0) return null
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-2">
      <div className="mb-1 text-xs font-medium text-warning">
        Low confidence — pick the right card
      </div>
      {ocrText ? (
        <div className="mb-2 text-[11px] text-text-muted italic">OCR: "{ocrText}"</div>
      ) : null}
      <div className="space-y-1">
        {alternatives.slice(0, 5).map((alt) => {
          const selected = alt.scryfallId === selectedScryfallId
          return (
            <button
              key={alt.scryfallId}
              type="button"
              onClick={() => onSelect(alt)}
              className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left transition ${selected ? 'bg-brand/30' : 'hover:bg-surface-2/60'}`}
            >
              <img src={ART(alt.scryfallId)} alt="" className="h-10 w-14 rounded object-cover" loading="lazy" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{alt.name}</div>
                <div className="text-[11px] text-text-muted uppercase">{alt.set} · {(alt.score * 100).toFixed(0)}% · {alt.source}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render in CardPreview when low confidence**

In `CardPreview.tsx`, after the existing result block, render:

```tsx
{state.result && state.alternatives.length > 1 && state.result.score < 0.85 ? (
  <CardPickerPanel
    alternatives={state.alternatives}
    selectedScryfallId={state.result.scryfallId}
    ocrText={state.ocrText}
    onSelect={(alt) => commitAlternative(alt)}
  />
) : null}
```

`commitAlternative` is a new method on `useCardQuery` that swaps `state.result` to the picked one (reuses the same shape).

- [ ] **Step 3: Add commitAlternative to useCardQuery**

```ts
const commitAlternative = useCallback((alt: CardQueryAlternative) => {
  setState((prev) => ({
    ...prev,
    result: { name: alt.name, set: alt.set, score: alt.score, scryfallId: alt.scryfallId },
  }))
}, [])
```

Expose it in the hook's return object and via `useCardQueryContext`.

- [ ] **Step 4: Typecheck + commit**

```bash
bun --cwd apps/web tsc --noEmit
git add apps/web/src/components/CardPickerPanel.tsx apps/web/src/components/CardPreview.tsx apps/web/src/hooks/useCardQuery.ts
git commit -m "feat(recognition): top-K picker UI for low-confidence matches"
```

---

## Task 7: Reset consensus buffer on tile click + manual identify

**Files:**
- Modify: `apps/web/src/hooks/useCardQuery.ts`
- Modify: `apps/web/src/components/LocalVideoCard.tsx`

- [ ] **Step 1: Expose `resetConsensus` from useCardQuery**

```ts
const resetConsensus = useCallback(() => {
  consensusBufferRef.current.clear()
  setState((prev) => ({ ...prev, alternatives: [] }))
}, [])
```

- [ ] **Step 2: Call on click in LocalVideoCard**

Update `handleIdentifyClick` to clear consensus before the new query, so the picker reflects only fresh frames:

```ts
const handleIdentifyClick = useCallback(() => {
  const canvas = getCroppedCanvas()
  if (!canvas) return
  cardQuery.resetConsensus()
  void cardQuery.query(canvas)
}, [cardQuery, getCroppedCanvas])
```

Also do the same in the remote tile's click handler in VideoStreamGrid.

- [ ] **Step 3: Typecheck + commit**

```bash
bun --cwd apps/web tsc --noEmit
git add apps/web/src/hooks/useCardQuery.ts apps/web/src/components/LocalVideoCard.tsx apps/web/src/components/VideoStreamGrid.tsx
git commit -m "feat(recognition): reset consensus buffer on manual identify"
```

---

## Task 8: E2E smoke test

**Files:**
- Create: `apps/web/tests/e2e/recognition-picker.spec.ts`

- [ ] **Step 1: Stub test**

```ts
import { test } from '@playwright/test'

test('low-confidence recognition shows top-K picker', async ({ page }) => {
  await page.goto('/')
  // Stub helper: inject a fake card-query state with low confidence + alternatives,
  // verify the picker renders and clicking an alternative updates the committed result.
  test.skip(true, 'Stub — implement once recognition test helpers exist')
})
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/tests/e2e/recognition-picker.spec.ts
git commit -m "test(e2e): scaffold recognition picker spec"
```

---

## Task 9: Final review pass

- [ ] **Step 1: Full preflight**

```bash
bun run preflight
```

- [ ] **Step 2: Manual two-card test**

- Hold two visually similar cards in sequence (e.g., two Forests from different sets).
- Verify the picker appears with both as alternatives, OCR text is populated, and clicking each commits and changes the Track menu's name.

- [ ] **Step 3: Push + open PR**

```bash
git push
gh pr create --base setup-card-detection --title "feat: recognition accuracy (OCR + consensus + picker)" --body "Implements docs/superpowers/specs/2026-04-25-recognition-accuracy-design.md"
```
