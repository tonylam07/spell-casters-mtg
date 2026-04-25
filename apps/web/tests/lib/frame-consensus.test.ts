import type { RankedCandidate } from '@/lib/recognition-fusion'
import { FrameConsensusBuffer } from '@/lib/frame-consensus'
import { describe, expect, it } from 'vitest'

const c = (
  id: string,
  score: number,
  source: 'clip' | 'ocr+clip' | 'ocr-only' = 'clip',
): RankedCandidate => ({
  card: { name: id, scryfallId: id, set: 'x', score },
  score,
  source,
})

describe('FrameConsensusBuffer', () => {
  it('returns the latest frame top when buffer has < 2 frames', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    b.push([c('a', 0.7), c('b', 0.5)])
    expect(b.consensus().top?.card.scryfallId).toBe('a')
  })

  it('votes by squared score across multiple frames', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    // Frame 1: a wins narrowly
    b.push([c('a', 0.6), c('b', 0.55)])
    // Frame 2: b wins big — squared score swings the tally
    b.push([c('b', 0.95), c('a', 0.4)])
    // Frame 3: b wins again
    b.push([c('b', 0.8), c('c', 0.3)])
    expect(b.consensus().top?.card.scryfallId).toBe('b')
  })

  it('exposes top-N alternatives in tally order', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    b.push([c('a', 0.9), c('b', 0.7), c('c', 0.5)])
    b.push([c('a', 0.85), c('b', 0.65), c('c', 0.45)])
    const result = b.consensus()
    expect(result.alternatives.map((alt) => alt.card.scryfallId)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('clear() empties the buffer', () => {
    const b = new FrameConsensusBuffer({ size: 8 })
    b.push([c('a', 0.9)])
    b.clear()
    expect(b.consensus().top).toBeNull()
  })

  it('caps the buffer at the configured size', () => {
    const b = new FrameConsensusBuffer({ size: 2 })
    b.push([c('a', 0.9)])
    b.push([c('b', 0.9)])
    b.push([c('c', 0.9)])
    expect(b.consensus().frameCount).toBe(2)
  })
})
