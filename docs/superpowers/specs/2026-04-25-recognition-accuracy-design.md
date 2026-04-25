# Recognition Accuracy — Design Spec

**Status:** Draft, pending review
**Date:** 2026-04-25

## Goal

Bring card-recognition accuracy from "CLIP-only, ~70%" to "TCGAutomate-class, 95%+" without changing the underlying model. Three orthogonal improvements:

1. **Title-bar OCR** — read the printed card name and exact-match against the Scryfall name index. OCR text is the ground truth for identity.
2. **Multi-frame consensus** — accumulate top-K results across the last N frames and vote, instead of trusting a single shot.
3. **Top-K picker UI** — when confidence is low, surface the top 3-5 candidates with thumbnails so the user can one-tap the right one.

These work in concert: OCR + multi-frame produce the candidate set; the picker handles the residual ambiguity.

## Decisions (proposed; flagged for user validation)

| # | Question | Proposed |
|---|---|---|
| 1 | When does OCR run? | **Always**, in parallel with CLIP. The two signals fuse into one ranked candidate list. (Alternative: only when CLIP < 0.85; rejected because OCR is also useful for set/printing disambiguation.) |
| 2 | OCR engine | **Tesseract.js**, English-only LSTM model, run in a Web Worker. ~2 MB lazy-loaded on first detection. |
| 3 | OCR region | Top 10% of the warped card crop (the title bar). Cards are ~63×88mm; title bar ≈ 9mm tall. |
| 4 | How is OCR fused with CLIP? | If OCR text exact-matches a unique Scryfall name → use as ground truth (CLIP only chooses printing). If multiple cards share that name → CLIP picks among them. If OCR returns gibberish → fall back to CLIP-only. |
| 5 | Multi-frame window | Last **8 frames** of detection (rolling buffer). At ~3 detections/sec that's ~2.5 seconds of consensus. |
| 6 | Multi-frame voting | Top-3 from each frame, weighted by score. Card winning the most weighted votes is the consensus. Tie-break by latest score. |
| 7 | Detection cadence | Detection loop runs at the **detector's natural rate** (currently ~3 fps for OpenCV). Frames where no card is found don't enter the buffer. |
| 8 | Confidence threshold for auto-commit | **0.85**. ≥ 0.85 → silently commit. < 0.85 → show top-K picker. |
| 9 | Top-K picker placement | Inline in the existing **CardPreview** sidebar slot. Renders top 5 thumbnails with name + set + score. Click commits and clears. |
| 10 | What "commit" means | Replace `cardQuery.state.result` with the chosen card. The Track menu uses this committed value. |

## Architecture

### New modules

```
apps/web/src/lib/title-ocr.ts          Title-bar OCR via Tesseract.js (worker)
apps/web/src/lib/recognition-fusion.ts CLIP + OCR fusion → ranked candidates
apps/web/src/lib/frame-consensus.ts    Rolling buffer + voting
apps/web/src/components/CardPickerPanel.tsx  Top-K picker UI
```

### Data flow

```
[Webcam frame]
       │
       ▼
[OpenCV detector] ── on detection ──▶ [warped card crop, 446×620 RGBA]
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                                          ▼
                [CLIP encoder]                          [Title-bar OCR (worker)]
                  → 512-dim                             → name string + confidence
                       │                                          │
                       ▼                                          │
                [topK(embedding, k=10)]                            │
                  → [{name, scryfallId, score}]                   │
                       │                                          │
                       └────────────────┬─────────────────────────┘
                                        ▼
                          [recognition-fusion.fuse()]
                            → ranked candidates [{card, score, source}]
                                        │
                                        ▼
                            [frame-consensus.push()]
                            (8-frame rolling buffer)
                                        │
                                        ▼
                            [frame-consensus.consensus()]
                            → {top: card, score, alternatives: card[]}
                                        │
                       ┌────────────────┴────────────────┐
                       ▼                                  ▼
            [score >= 0.85]                       [score < 0.85]
                       │                                  │
                       ▼                                  ▼
            [commit silently]                  [render CardPickerPanel
                                                with top 5 alternatives]
```

### Fusion algorithm (CLIP × OCR)

Pseudocode:

```
function fuse(clipTopK, ocrText):
  if ocrText is empty or all-noise:
    return clipTopK    # CLIP-only fallback

  normalized = normalize(ocrText)   # lowercase, strip punct, collapse spaces
  scryfallMatches = nameIndex.lookup(normalized)  # exact + fuzzy edit-distance ≤ 2

  if scryfallMatches.length == 0:
    return clipTopK    # OCR didn't help, keep CLIP

  if scryfallMatches.length == 1:
    # Single name match. Find the printing CLIP scored highest.
    bestPrinting = clipTopK.find(c => c.name == scryfallMatches[0]) ?? scryfallMatches[0].defaultPrinting
    return [{ card: bestPrinting, score: 0.99, source: 'ocr+clip' }, ...clipTopK]

  # Multiple cards share this name (unlikely but possible — split cards, etc.)
  # Re-rank CLIP results to put OCR-matching ones first.
  return [
    ...clipTopK.filter(c => scryfallMatches.includes(c.name)).map(c => ({ ...c, score: c.score * 1.3 })),
    ...clipTopK.filter(c => !scryfallMatches.includes(c.name)),
  ]
```

### Frame consensus

Rolling buffer of size 8. Each entry: `{ candidates: rankedCandidate[], timestamp: number }`. Entries older than 5 seconds are pruned.

`consensus()` returns the top-N cards by **weighted vote count**:
- For each frame, the top-3 candidates contribute their score to a per-card tally.
- Score is squared so high-confidence frames dominate.
- Final ranking: sort by tally desc.

If the buffer has fewer than 2 frames, we don't try to compute consensus — just return the latest frame's top-1.

### Top-K picker UI

Renders inline in the existing CardPreview sidebar slot when:
- Top-1 score < 0.85, OR
- The user explicitly invokes a "show alternatives" affordance on a committed result.

Layout: vertical list of up to 5 cards. Each row has art crop (40×56), name, set code, and score badge. The committed card has a "Track this card" button next to it.

## Schema impact

**None.** All work is client-side. No Convex schema changes.

## Performance budget

| Stage | Current | After |
|---|---|---|
| Detection (OpenCV) | ~30ms | ~30ms |
| CLIP embed | ~150ms (CPU) | ~150ms |
| Top-K search (46k) | ~10ms | ~10ms |
| **Title OCR (NEW)** | — | ~80ms in Web Worker (parallel with CLIP) |
| Fusion + consensus | — | <1ms |
| **Total per detection** | ~200ms | ~200ms (OCR is parallel) |

OCR runs in a worker so the main thread isn't blocked. Tesseract initialization (~500ms first time) is hidden behind the existing CLIP model load.

## Out of scope (future)

- Set/edition disambiguation by collector-number OCR (would slot in after title OCR is shipped)
- Replacing CLIP with SigLIP or fine-tuned model
- Embedding quantization (int8)
- Camera setup wizard
- Per-card pHash/dHash ensemble channel

## Open questions

All 10 decisions above are proposed but reversible. Approve as-is or override.
