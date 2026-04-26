import type { CardMeta, EmbeddingMetrics } from '@/lib/clip-search'
import type { ClipResult, RankedCandidate } from '@/lib/recognition-fusion'
import type { NameIndex } from '@/lib/scryfall-name-index'
import type {
  CardHistoryEntry,
  CardQueryAlternative,
  CardQueryResult,
  CardQueryState,
  UseCardQueryReturn,
} from '@/types/card-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  embedFromCanvas,
  getCardMetadata,
  isModelReady,
  loadEmbeddingsAndMetaFromPackage,
  loadModel,
  top1,
  topK,
} from '@/lib/clip-search'
import { generateOrientationCandidates } from '@/lib/detectors/geometry/orientation'
import { FrameConsensusBuffer } from '@/lib/frame-consensus'
import { fuse } from '@/lib/recognition-fusion'
import { buildNameIndex } from '@/lib/scryfall-name-index'
import { runTitleOcr } from '@/lib/title-ocr'
import { validateCanvas } from '@/types/card-query'

/**
 * Lazy-built scryfall name index. We don't have direct access to the loaded
 * card metadata from this module, so getNameIndex() fishes the metadata out
 * of `topK`'s loaded state via a one-time best-effort warm-up. Failure is
 * non-fatal — fusion will simply CLIP-only.
 */
let cachedNameIndex: NameIndex | null = null
async function getNameIndex(): Promise<NameIndex | null> {
  if (cachedNameIndex) return cachedNameIndex
  try {
    await loadEmbeddingsAndMetaFromPackage()
    const meta = getCardMetadata()
    if (!meta) return null
    const entries = meta
      .filter((m): m is CardMeta & { scryfallId: string } => !!m.scryfallId)
      .map((m) => ({
        name: m.name,
        scryfallId: m.scryfallId,
        set: m.set,
      }))
    cachedNameIndex = buildNameIndex(entries)
    return cachedNameIndex
  } catch (err) {
    console.warn('[useCardQuery] failed to build name index:', err)
    return null
  }
}

function toAlternative(rc: RankedCandidate): CardQueryAlternative {
  return {
    scryfallId: rc.card.scryfallId,
    name: rc.card.name,
    set: rc.card.set,
    score: rc.score,
    source: rc.source,
  }
}

/** Maximum number of history entries to store per room */
const MAX_HISTORY_ENTRIES = 30

/** Prefix for localStorage key */
const STORAGE_KEY_PREFIX = 'spell-casters:card-history:'

/**
 * Load card history from localStorage for a specific room
 */
function loadHistory(roomId: string): CardHistoryEntry[] {
  if (!roomId) return []
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${roomId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as CardHistoryEntry[]
  } catch {
    return []
  }
}

/**
 * Save card history to localStorage for a specific room
 */
function saveHistory(roomId: string, history: CardHistoryEntry[]): void {
  if (!roomId) return
  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${roomId}`,
      JSON.stringify(history),
    )
  } catch {
    // Ignore quota errors
  }
}

/**
 * Remove card history from localStorage for a specific room
 */
function removeHistory(roomId: string): void {
  if (!roomId) return
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${roomId}`)
  } catch {
    // Ignore errors
  }
}

/**
 * Create a history entry from a CardQueryResult
 */
function createHistoryEntry(
  result: CardQueryResult,
  source: 'search' | 'detection',
): CardHistoryEntry {
  return {
    id: `${result.name}:${result.set}`,
    name: result.name,
    set: result.set,
    image_url: result.image_url,
    card_url: result.card_url,
    scryfall_uri: result.scryfall_uri,
    timestamp: Date.now(),
    source,
  }
}

export function useCardQuery(roomId: string): UseCardQueryReturn {
  const [state, setState] = useState<CardQueryState>({
    status: 'idle',
    result: null,
    error: null,
    queryImageUrl: null,
    alternatives: [],
  })

  // Multi-frame consensus voter: lives across queries within this hook
  // instance. Cleared on manual identify (LocalVideoCard click) so picker
  // alternatives reflect only the latest sequence of detections.
  const consensusBufferRef = useRef<FrameConsensusBuffer | null>(null)
  if (!consensusBufferRef.current) {
    consensusBufferRef.current = new FrameConsensusBuffer({ size: 8 })
  }

  // History state
  const [history, setHistory] = useState<CardHistoryEntry[]>([])

  // Dismissed state - when true, preview is hidden even if history exists
  const [isDismissed, setIsDismissed] = useState(false)

  // Track roomId to detect changes
  const roomIdRef = useRef<string>(roomId)

  // Load history from localStorage on mount or when roomId changes
  useEffect(() => {
    if (roomId !== roomIdRef.current) {
      roomIdRef.current = roomId
      setIsDismissed(false) // Reset dismissed state when switching rooms
    }
    const loaded = loadHistory(roomId)
    setHistory(loaded)
  }, [roomId])

  /**
   * Add an entry to history (capped at MAX_HISTORY_ENTRIES, most recent first)
   */
  const addToHistory = useCallback(
    (result: CardQueryResult, source: 'search' | 'detection') => {
      const entry = createHistoryEntry(result, source)
      setHistory((prev) => {
        // Remove duplicate if it exists (same id)
        const filtered = prev.filter((e) => e.id !== entry.id)
        // Add to front and cap
        const updated = [entry, ...filtered].slice(0, MAX_HISTORY_ENTRIES)
        saveHistory(roomId, updated)
        return updated
      })
    },
    [roomId],
  )

  /**
   * Clear the history for current room
   */
  const clearHistory = useCallback(() => {
    setHistory([])
    removeHistory(roomId)
  }, [roomId])

  /**
   * Remove a single entry from history (by id and timestamp)
   */
  const removeFromHistory = useCallback(
    (entry: CardHistoryEntry) => {
      setHistory((prev) => {
        const updated = prev.filter(
          (e) => !(e.id === entry.id && e.timestamp === entry.timestamp),
        )
        saveHistory(roomId, updated)
        return updated
      })
    },
    [roomId],
  )

  const abortControllerRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  /**
   * Clear the current result state and dismiss the preview
   */
  const clearResult = useCallback(() => {
    cancel()
    setIsDismissed(true) // Dismiss the preview
    consensusBufferRef.current?.clear()
    setState({
      status: 'idle',
      result: null,
      error: null,
      queryImageUrl: null,
      alternatives: [],
    })
  }, [cancel])

  /**
   * Manually set a card result (e.g., from Scryfall search selection).
   * Cancels any pending query and sets state to success.
   * Adds the result to history.
   */
  const setResult = useCallback(
    (result: CardQueryResult) => {
      cancel()
      setIsDismissed(false) // Un-dismiss when new card is selected
      setState({
        status: 'success',
        result,
        error: null,
        queryImageUrl: null, // Clear query image when manually setting result
        alternatives: [],
      })
      // Add to history
      addToHistory(result, 'search')
    },
    [cancel, addToHistory],
  )

  /**
   * Set a card result without adding to history (e.g., clicking history entry).
   * Cancels any pending query and sets state to success.
   */
  const setResultWithoutHistory = useCallback(
    (result: CardQueryResult) => {
      cancel()
      setIsDismissed(false) // Un-dismiss when selecting from history
      setState({
        status: 'success',
        result,
        error: null,
        queryImageUrl: null, // Clear query image when manually setting result
        alternatives: [],
      })
      // Do NOT add to history
    },
    [cancel],
  )

  const query = useCallback(
    async (canvas: HTMLCanvasElement) => {
      console.log('[useCardQuery] Query called with canvas:', {
        width: canvas.width,
        height: canvas.height,
      })

      // Cancel any pending query
      cancel()

      // Create new abort controller for this query
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // Validate canvas
      const validation = validateCanvas(canvas)
      console.log('[useCardQuery] Canvas validation:', validation)

      if (!validation.isValid) {
        console.error(
          '[useCardQuery] Canvas validation failed:',
          validation.error,
        )
        setState({
          status: 'error',
          result: null,
          error: validation.error || 'Invalid canvas',
          queryImageUrl: null,
          alternatives: [],
        })
        return
      }

      // Capture query image as data URL (for development debugging)
      const queryImageUrl = canvas.toDataURL('image/png')

      // Set querying state (preserve any prior alternatives so the picker
      // doesn't blink while a fresh query runs)
      setState((prev) => ({
        status: 'querying',
        result: prev.result,
        error: null,
        queryImageUrl,
        alternatives: prev.alternatives,
        ocrText: prev.ocrText,
      }))

      try {
        // Check if aborted
        if (abortController.signal.aborted) {
          return
        }

        // Ensure model and database are loaded before proceeding
        if (!isModelReady()) {
          console.log('[useCardQuery] Model/database not ready, loading now...')
          try {
            // Load embeddings and model in parallel for faster initialization
            await Promise.all([loadEmbeddingsAndMetaFromPackage(), loadModel()])
            console.log('[useCardQuery] Model and database loaded successfully')
          } catch (loadErr) {
            const errorMessage =
              loadErr instanceof Error
                ? loadErr.message
                : 'Failed to load CLIP model or embeddings database'
            console.error(
              '[useCardQuery] Failed to load model/database:',
              loadErr,
            )
            setState({
              status: 'error',
              result: null,
              error: errorMessage,
              queryImageUrl,
              alternatives: [],
            })
            return
          }
        }

        // Check if aborted after loading
        if (abortController.signal.aborted) {
          return
        }

        // Generate all orientation candidates and search for the best match
        console.log('[useCardQuery] Generating orientation candidates...')
        const orientationCandidates = generateOrientationCandidates(canvas)
        if (!orientationCandidates.length) {
          throw new Error(
            'useCardQuery: Failed to generate orientation candidates',
          )
        }
        console.log(
          '[useCardQuery] Generated orientation candidates:',
          orientationCandidates.length,
        )

        let bestResult: ReturnType<typeof top1> | null = null
        let bestScore = -Infinity
        let bestOrientation = -1
        let bestEmbeddingMetrics: EmbeddingMetrics | null = null
        let totalEmbeddingMs = 0
        let totalSearchMs = 0
        let bestEmbedding: Float32Array | null = null
        const TOP_K = 5

        for (let i = 0; i < orientationCandidates.length; i++) {
          const candidate = orientationCandidates[i]
          if (!candidate) continue

          // Check if aborted
          if (abortController.signal.aborted) {
            return
          }

          // Log the candidate canvas
          candidate.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob)
              console.groupCollapsed(
                `%c[DEBUG STAGE 4] Card orientation candidate ${i} (ready for embedding)`,
                'background: #E91E63; color: white; padding: 2px 6px; border-radius: 3px;',
              )
              console.log(
                '%c ',
                `background: url(${url}) no-repeat; background-size: contain; padding: 150px;`,
              )
              console.log('Blob URL (copy this):', url)
              console.log(
                'Dimensions:',
                `${candidate.width}x${candidate.height}`,
              )
              console.groupEnd()
            }
          }, 'image/png')

          // Synchronous log to confirm code execution continues after toBlob
          console.log(
            `[useCardQuery] Proceeding to embed orientation candidate ${i} (toBlob logged asynchronously above)`,
          )

          // Embed the candidate
          console.log(
            `[useCardQuery] Starting embedding for orientation ${i}...`,
          )
          let embedding: Float32Array
          let embeddingMetrics: EmbeddingMetrics
          try {
            const embeddingResult = await embedFromCanvas(candidate)
            embedding = embeddingResult.embedding
            embeddingMetrics = embeddingResult.metrics
          } catch (err) {
            console.error(
              `[useCardQuery] Failed to embed canvas for orientation ${i}:`,
              err,
            )
            throw new Error(
              `Failed to embed canvas: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          totalEmbeddingMs += embeddingMetrics.total
          console.log(`[useCardQuery] Embedding completed for orientation ${i}`)

          // Query the database
          console.log('[useCardQuery] Embedding dimension:', embedding.length)
          console.log('[useCardQuery] About to query database with top1()...')
          const searchStart = performance.now()
          let result
          try {
            result = top1(embedding)
            console.log('[useCardQuery] top1() returned result:', result)
          } catch (err) {
            console.error('[useCardQuery] top1() threw error:', err)
            throw err
          }
          const searchMs = performance.now() - searchStart
          totalSearchMs += searchMs
          console.log(
            `[useCardQuery] Database search completed in ${searchMs.toFixed(0)}ms (orientation ${i})`,
          )
          console.log('[useCardQuery] Search result:', result)

          // Log orientation score prominently
          const orientationLabel =
            ['0°', '90°', '180°', '270°'][i] || `${i * 90}°`
          console.log(
            `%c[ORIENTATION ${i}] ${orientationLabel} → score=${result?.score?.toFixed(4) ?? 'N/A'} match="${result?.name ?? 'none'}"`,
            result && result.score > bestScore
              ? 'background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;'
              : 'background: #9E9E9E; color: white; padding: 2px 6px; border-radius: 3px;',
          )

          if (result && result.score > bestScore) {
            bestScore = result.score
            bestResult = result
            bestOrientation = i
            bestEmbeddingMetrics = embeddingMetrics
            bestEmbedding = embedding
          }
        }

        if (!bestResult) {
          throw new Error('No valid result from database search')
        }

        // Log winning orientation summary
        const winningLabel =
          ['0°', '90°', '180°', '270°'][bestOrientation] ||
          `${bestOrientation * 90}°`
        console.log(
          `%c[ORIENTATION WINNER] ${winningLabel} (index ${bestOrientation}) → score=${bestScore.toFixed(4)} match="${bestResult.name}"`,
          'background: #2196F3; color: white; padding: 4px 8px; border-radius: 3px; font-weight: bold; font-size: 12px;',
        )

        // Check if aborted after query
        if (abortController.signal.aborted) {
          return
        }

        if (bestEmbedding) {
          const topKResults = topK(bestEmbedding, TOP_K)
          console.groupCollapsed(
            `[useCardQuery] Top-${TOP_K} results (orientation ${bestOrientation})`,
          )
          topKResults.forEach((item, index) => {
            console.log(
              `#${index + 1} score=${item.score.toFixed(4)} name="${item.name}" set=${item.set}`,
            )
          })
          console.groupEnd()
        }

        // Log performance summary
        const canvasWithMetrics = canvas as HTMLCanvasElement & {
          __pipelineMetrics?: { detection: number; crop: number }
        }
        if (canvasWithMetrics.__pipelineMetrics) {
          const metrics = canvasWithMetrics.__pipelineMetrics
          const totalMs =
            metrics.detection + metrics.crop + totalEmbeddingMs + totalSearchMs

          console.log('🎯 Pipeline Performance:', {
            Detection: `${metrics.detection.toFixed(0)}ms`,
            'Crop & Warp': `${metrics.crop.toFixed(0)}ms`,
            Embedding: `${totalEmbeddingMs.toFixed(0)}ms`,
            Search: `${totalSearchMs.toFixed(0)}ms`,
            Total: `${totalMs.toFixed(0)}ms`,
          })
          console.log('[useCardQuery] Best orientation index:', bestOrientation)

          // Log detailed embedding breakdown if contrast enhancement is enabled
          if (bestEmbeddingMetrics && bestEmbeddingMetrics.contrast > 0) {
            console.log('📊 Embedding Breakdown:', {
              'Contrast Enhancement': `${bestEmbeddingMetrics.contrast.toFixed(0)}ms`,
              'CLIP Inference': `${bestEmbeddingMetrics.inference.toFixed(0)}ms`,
              'L2 Normalization': `${bestEmbeddingMetrics.normalization.toFixed(0)}ms`,
              'Total Embedding': `${bestEmbeddingMetrics.total.toFixed(0)}ms`,
            })
          } else {
            console.log('📊 Embedding Breakdown:', {
              'CLIP Inference': `${bestEmbeddingMetrics?.inference.toFixed(0) ?? '0'}ms`,
              'L2 Normalization': `${bestEmbeddingMetrics?.normalization.toFixed(0) ?? '0'}ms`,
              'Total Embedding': `${bestEmbeddingMetrics?.total.toFixed(0) ?? '0'}ms`,
            })
          }
        }

        // Use the winning orientation's canvas for the query image
        const winningCanvas = orientationCandidates[bestOrientation]
        const finalQueryImageUrl = winningCanvas
          ? winningCanvas.toDataURL('image/png')
          : queryImageUrl

        // Build the CLIP top-K list for fusion. Falls back gracefully if the
        // best embedding wasn't captured (shouldn't happen).
        const clipTopK: ClipResult[] = bestEmbedding
          ? topK(bestEmbedding, 5).map((r) => ({
              name: r.name,
              scryfallId: r.scryfallId ?? '',
              set: r.set,
              score: r.score,
            }))
          : [
              {
                name: bestResult.name,
                scryfallId: bestResult.scryfallId ?? '',
                set: bestResult.set,
                score: bestResult.score,
              },
            ]

        // Run OCR + fusion + consensus in parallel with the rest of the
        // success path. OCR errors are swallowed; CLIP-only is still useful.
        const [ocrResult, nameIndex] = await Promise.all([
          winningCanvas
            ? runTitleOcr(winningCanvas).catch((err) => {
                console.warn('[useCardQuery] title OCR failed:', err)
                return { text: '', confidence: 0, durationMs: 0 }
              })
            : Promise.resolve({ text: '', confidence: 0, durationMs: 0 }),
          getNameIndex(),
        ])

        const fused = nameIndex
          ? fuse(clipTopK, ocrResult.text, ocrResult.confidence, nameIndex)
          : clipTopK.map((c) => ({
              card: c,
              score: c.score,
              source: 'clip' as const,
            }))

        consensusBufferRef.current?.push(fused)
        const consensus = consensusBufferRef.current?.consensus()
        const consensusTop = consensus?.top
        const alternatives = (consensus?.alternatives ?? []).map(toAlternative)

        // Use the consensus top if higher than the single-frame best, else
        // fall back to the single-frame top1.
        // When using consensus, enrich with image_url/card_url from the metadata
        // index (the ClipResult only carries name/set/scryfallId/score).
        const finalResult: CardQueryResult = consensusTop
          ? (() => {
              const allMeta = getCardMetadata()
              const fullMeta = allMeta?.find(
                (m) =>
                  (m.scryfallId && m.scryfallId === consensusTop.card.scryfallId) ||
                  (m.name === consensusTop.card.name && m.set === consensusTop.card.set),
              )
              return {
                name: consensusTop.card.name,
                set: consensusTop.card.set,
                score: consensusTop.score,
                scryfallId: consensusTop.card.scryfallId,
                image_url: fullMeta?.image_url,
                card_url: fullMeta?.card_url,
                scryfall_uri: fullMeta?.scryfall_uri,
              }
            })()
          : bestResult

        if (ocrResult.text) {
          console.log(
            `%c[OCR] "${ocrResult.text}" (conf=${(ocrResult.confidence * 100).toFixed(0)}%, ${ocrResult.durationMs.toFixed(0)}ms)`,
            'background: #FF9800; color: white; padding: 2px 6px; border-radius: 3px;',
          )
        }

        // Set success state
        setIsDismissed(false) // Un-dismiss when new card is detected
        setState({
          status: 'success',
          result: finalResult,
          error: null,
          queryImageUrl: finalQueryImageUrl,
          alternatives,
          ocrText: ocrResult.text || undefined,
        })
        // Add to history (detection source)
        addToHistory(finalResult, 'detection')
        console.log(
          '[useCardQuery] State updated to success, orientation:',
          bestOrientation,
        )
      } catch (err) {
        // Only update state if not aborted
        if (!abortController.signal.aborted) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to identify card'

          setState({
            status: 'error',
            result: null,
            error: errorMessage,
            queryImageUrl,
            alternatives: [],
          })
        }
      } finally {
        // Clear abort controller if this was the active one
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
      }
    },
    [cancel, addToHistory],
  )

  const commitAlternative = useCallback(
    (alt: CardQueryAlternative) => {
      setState((prev) => ({
        ...prev,
        status: 'success',
        result: {
          name: alt.name,
          set: alt.set,
          score: alt.score,
          scryfallId: alt.scryfallId,
        },
        error: null,
      }))
      addToHistory(
        {
          name: alt.name,
          set: alt.set,
          score: alt.score,
          scryfallId: alt.scryfallId,
        },
        'detection',
      )
    },
    [addToHistory],
  )

  const resetConsensus = useCallback(() => {
    consensusBufferRef.current?.clear()
    setState((prev) => ({ ...prev, alternatives: [] }))
  }, [])

  // Suppress unused-import warning for useMemo (kept for future use)
  void useMemo

  return {
    state,
    query,
    cancel,
    setResult,
    setResultWithoutHistory,
    history,
    isDismissed,
    clearHistory,
    clearResult,
    removeFromHistory,
    commitAlternative,
    resetConsensus,
  }
}
