/**
 * Rolling-buffer consensus voter for recognition results.
 *
 * Takes the fused (CLIP + OCR) candidate list from each detection frame and
 * accumulates votes by squared score. The card with the highest tally wins.
 * This smooths over single-frame misclassifications (the card briefly out of
 * focus, partial occlusion, etc.) and gives a stable result over a few
 * seconds of detection.
 */
import type { RankedCandidate } from './recognition-fusion'

interface Frame {
  candidates: RankedCandidate[]
  timestamp: number
}

export interface ConsensusResult {
  top: RankedCandidate | null
  /** Up to topNAlternatives candidates (including top), ordered by tally desc */
  alternatives: RankedCandidate[]
  frameCount: number
}

interface BufferOptions {
  size: number
  /** Frames older than this are discarded on the next consensus() call */
  maxAgeMs?: number
  topNPerFrame?: number
  topNAlternatives?: number
}

const DEFAULT_MAX_AGE_MS = 5000
const DEFAULT_TOP_N_PER_FRAME = 3
const DEFAULT_TOP_N_ALTERNATIVES = 5

export class FrameConsensusBuffer {
  private frames: Frame[] = []
  private readonly size: number
  private readonly maxAgeMs: number
  private readonly topNPerFrame: number
  private readonly topNAlternatives: number

  constructor(opts: BufferOptions) {
    this.size = opts.size
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    this.topNPerFrame = opts.topNPerFrame ?? DEFAULT_TOP_N_PER_FRAME
    this.topNAlternatives = opts.topNAlternatives ?? DEFAULT_TOP_N_ALTERNATIVES
  }

  push(candidates: RankedCandidate[]): void {
    this.frames.push({ candidates, timestamp: Date.now() })
    if (this.frames.length > this.size) {
      this.frames.shift()
    }
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
      const frame = this.frames[0]
      const top = frame?.candidates[0] ?? null
      return {
        top,
        alternatives: frame?.candidates.slice(0, this.topNAlternatives) ?? [],
        frameCount: 1,
      }
    }

    // Tally squared scores so high-confidence frames dominate.
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
