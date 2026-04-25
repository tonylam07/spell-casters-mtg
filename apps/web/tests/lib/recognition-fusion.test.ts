import { fuse } from '@/lib/recognition-fusion'
import { buildNameIndex } from '@/lib/scryfall-name-index'
import { describe, expect, it } from 'vitest'

const index = buildNameIndex([
  { name: 'Sol Ring', scryfallId: 'a', set: 'cmd' },
  { name: 'Sol Ring', scryfallId: 'b', set: 'lea' },
  { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea' },
])

describe('fuse', () => {
  it('promotes the OCR-matched card with high boosted score', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.6 },
      { name: 'Sol Ring', scryfallId: 'a', set: 'cmd', score: 0.55 },
    ]
    const fused = fuse(clipTopK, 'Sol Ring', 0.9, index)
    const top = fused[0]
    expect(top).toBeDefined()
    if (!top) return
    expect(top.card.name).toBe('Sol Ring')
    expect(top.score > 0.95).toBe(true)
    expect(top.source).toBe('ocr+clip')
  })

  it('falls back to CLIP-only when OCR is empty', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.8 },
    ]
    const fused = fuse(clipTopK, '', 0, index)
    expect(fused[0]?.card.name).toBe('Lightning Bolt')
    expect(fused[0]?.source).toBe('clip')
  })

  it('falls back to CLIP-only when OCR is below confidence floor', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.8 },
    ]
    const fused = fuse(clipTopK, 'sol ring', 0.2, index)
    expect(fused[0]?.source).toBe('clip')
  })

  it('falls back to CLIP-only when OCR text matches no card', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.8 },
    ]
    const fused = fuse(clipTopK, 'completely unknown card name', 0.9, index)
    expect(fused[0]?.source).toBe('clip')
  })

  it('emits ocr-only candidates when CLIP missed the matching card', () => {
    const clipTopK = [
      { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea', score: 0.5 },
    ]
    const fused = fuse(clipTopK, 'Sol Ring', 0.9, index)
    expect(fused[0]?.card.name).toBe('Sol Ring')
    expect(fused[0]?.source).toBe('ocr-only')
    // Fallback emits one entry per Scryfall printing
    const ocrOnly = fused.filter((f) => f.source === 'ocr-only')
    expect(ocrOnly).toHaveLength(2)
  })
})
