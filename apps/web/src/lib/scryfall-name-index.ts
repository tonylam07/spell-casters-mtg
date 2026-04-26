/**
 * Scryfall name index — fast lookup from a (possibly noisy) OCR string to
 * matching cards. Exact-matches first, then a bounded edit-distance fallback.
 *
 * Used by recognition-fusion to combine OCR text with CLIP top-K results.
 */

export interface CardEntry {
  name: string
  scryfallId: string
  set: string
}

export interface NameIndex {
  byNormalized: Map<string, CardEntry[]>
  allNames: string[]
}

/** Lowercase, strip non-alphanumeric, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Levenshtein distance between two strings. Returns `maxDist + 1` early if
 * the distance is guaranteed to exceed the threshold.
 */
export function editDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  const dp: number[] = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0] ?? 0
    dp[0] = j
    let rowMin = dp[0]
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i] ?? 0
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i] = Math.min(
        (dp[i] ?? 0) + 1, // deletion
        (dp[i - 1] ?? 0) + 1, // insertion
        prev + cost, // substitution
      )
      prev = tmp
      if ((dp[i] ?? Infinity) < rowMin) rowMin = dp[i] ?? rowMin
    }
    if (rowMin > maxDist) return maxDist + 1
  }
  return dp[a.length] ?? maxDist + 1
}

export function buildNameIndex(cards: CardEntry[]): NameIndex {
  const byNormalized = new Map<string, CardEntry[]>()
  for (const c of cards) {
    // Collect candidate keys: the full name, plus each side of split / DFC
    // names. De-dup so split cards (e.g. "Wear // Tear") don't produce
    // duplicate hits when the OCR matches the full name.
    const keys = new Set<string>()
    keys.add(normalize(c.name))
    for (const side of c.name.split(/\s*\/\/\s*/)) {
      keys.add(normalize(side))
    }
    keys.delete('')
    for (const norm of keys) {
      const arr = byNormalized.get(norm) ?? []
      arr.push(c)
      byNormalized.set(norm, arr)
    }
  }
  return { byNormalized, allNames: Array.from(byNormalized.keys()) }
}

export function lookupName(index: NameIndex, query: string): CardEntry[] {
  const norm = normalize(query)
  if (!norm) return []
  const exactHit = index.byNormalized.get(norm)
  if (exactHit && exactHit.length > 0) return exactHit
  // Fuzzy fallback. Tighter for short strings to avoid spurious matches.
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
