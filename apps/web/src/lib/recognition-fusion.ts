/**
 * Combine CLIP top-K results with Tesseract OCR text into a ranked candidate
 * list. OCR text — when it confidently matches a card name — is treated as
 * ground truth: the matching card is promoted to the top with a high fused
 * score. CLIP still picks among multiple printings of the same name.
 */
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
const OCR_ONLY_FALLBACK_SCORE = 0.85

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
  const promoted: RankedCandidate[] = []
  const remaining: RankedCandidate[] = []
  for (const c of clipTopK) {
    if (matchedNames.has(c.name)) {
      promoted.push({ card: c, score: OCR_BOOST_SCORE, source: 'ocr+clip' })
    } else {
      remaining.push({ card: c, score: c.score, source: 'clip' })
    }
  }
  if (promoted.length === 0) {
    // CLIP didn't surface any printing of the OCR'd card. Fall back to the
    // first scryfall match for each unique name; without CLIP we can't
    // choose between printings, so the user picks via the top-K UI.
    const seen = new Set<string>()
    for (const m of matches) {
      if (seen.has(m.scryfallId)) continue
      seen.add(m.scryfallId)
      promoted.push({
        card: m,
        score: OCR_ONLY_FALLBACK_SCORE,
        source: 'ocr-only',
      })
    }
  }
  return [...promoted, ...remaining]
}
