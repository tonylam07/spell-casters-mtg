import type { Worker } from 'tesseract.js'
import { createWorker } from 'tesseract.js'

/**
 * Title-bar OCR via Tesseract.js. Reads the printed card name from the top
 * strip of a warped card crop. Result is fused with CLIP top-K to disambiguate
 * visually similar cards.
 *
 * Tesseract.js spawns its own Web Worker internally, so the OCR call doesn't
 * block the main thread. The English LSTM model (~5 MB) lazy-loads on first
 * call.
 */

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker('eng')
      await w.setParameters({
        // Card titles are alphanumerics plus a small set of punctuation
        // (apostrophes in "Aetherflux", commas in titles like "Akiri,
        // Fearless Voyager", etc.). Restricting the whitelist meaningfully
        // improves OCR accuracy.
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,.-'",
      })
      return w
    })()
  }
  return workerPromise
}

export interface TitleOcrResult {
  text: string
  /** [0, 1]; Tesseract reports per-character then averages; we normalize from [0, 100] */
  confidence: number
  /** ms spent in OCR */
  durationMs: number
}

/**
 * Extract and OCR the top ~11% of the warped card. The title bar on a real
 * MTG card is roughly the top 10% of the printed area. We start at 2% to skip
 * the very edge of the crop where artifacts are common.
 */
export async function runTitleOcr(
  cardCanvas: HTMLCanvasElement,
): Promise<TitleOcrResult> {
  const start = performance.now()
  const titleH = Math.round(cardCanvas.height * 0.11)
  const titleY = Math.round(cardCanvas.height * 0.02)
  const titleStrip = document.createElement('canvas')
  titleStrip.width = cardCanvas.width
  titleStrip.height = titleH
  const ctx = titleStrip.getContext('2d')
  if (!ctx) {
    return { text: '', confidence: 0, durationMs: performance.now() - start }
  }
  ctx.drawImage(
    cardCanvas,
    0,
    titleY,
    cardCanvas.width,
    titleH,
    0,
    0,
    cardCanvas.width,
    titleH,
  )

  // Hard-threshold to maximize legibility; card titles are typically
  // dark text on a high-contrast background.
  const img = ctx.getImageData(0, 0, titleStrip.width, titleStrip.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0)) / 3
    const enhanced = v > 128 ? 255 : 0
    d[i] = enhanced
    d[i + 1] = enhanced
    d[i + 2] = enhanced
  }
  ctx.putImageData(img, 0, 0)

  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(titleStrip)
    return {
      text: (data.text ?? '').trim(),
      confidence: (data.confidence ?? 0) / 100,
      durationMs: performance.now() - start,
    }
  } catch (err) {
    console.error('[title-ocr] recognize failed:', err)
    return { text: '', confidence: 0, durationMs: performance.now() - start }
  }
}

/** Optional cleanup for tests / route teardown */
export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    try {
      const worker = await workerPromise
      await worker.terminate()
    } catch {
      // already terminated, ignore
    }
    workerPromise = null
  }
}
