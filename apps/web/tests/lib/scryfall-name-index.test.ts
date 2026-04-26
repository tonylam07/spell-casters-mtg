import {
  buildNameIndex,
  lookupName,
  normalize,
} from '@/lib/scryfall-name-index'
import { describe, expect, it } from 'vitest'

const cards = [
  { name: 'Sol Ring', scryfallId: 'a', set: 'cmd' },
  { name: 'Sol Ring', scryfallId: 'b', set: 'lea' },
  { name: 'Lightning Bolt', scryfallId: 'c', set: 'lea' },
  { name: 'Wear // Tear', scryfallId: 'd', set: 'dgm' },
]

describe('normalize', () => {
  it('lowercases and strips punctuation/whitespace', () => {
    expect(normalize('  Sol-Ring!! ')).toBe('solring')
    expect(normalize('Lightning   Bolt')).toBe('lightning bolt')
  })
})

describe('lookupName', () => {
  const index = buildNameIndex(cards)

  it('exact-matches case-insensitively, ignoring punctuation', () => {
    expect(lookupName(index, 'sol ring')).toHaveLength(2)
    expect(lookupName(index, 'SOL RING')).toHaveLength(2)
    expect(lookupName(index, 'lightning  bolt')).toHaveLength(1)
  })

  it('matches both sides of split / DFC card names', () => {
    expect(lookupName(index, 'wear')[0]?.scryfallId).toBe('d')
    expect(lookupName(index, 'tear')[0]?.scryfallId).toBe('d')
  })

  it('returns [] for noise', () => {
    expect(lookupName(index, '@@@!!!')).toEqual([])
    expect(lookupName(index, '')).toEqual([])
  })

  it('fuzzy-matches single-character OCR errors (edit distance ≤ 2)', () => {
    expect(lookupName(index, 'lightening bolt')).toHaveLength(1) // insertion
    expect(lookupName(index, 'lightning bilt')).toHaveLength(1) // substitution
  })
})
