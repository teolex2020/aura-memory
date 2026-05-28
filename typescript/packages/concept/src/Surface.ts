/**
 * Concept surface functions.
 *
 * Filters disclosed concepts (Stable or Candidate state), sorts by 5-dim
 * tiebreak (abstraction_score → confidence → cluster_size → stable priority → key),
 * caps at MAX_SURFACED_PER_NAMESPACE per namespace, and deduplicates by key.
 *
 * Aligns with Rust `concept.rs` surface_concepts() (lines 1854-1965):
 *   - Phase A: filter eligible concepts (state + score threshold + provenance)
 *   - Phase B: optional namespace filter
 *   - Phase C: sort deterministic 5-dim tiebreak
 *   - Phase D: dedup by key → per-namespace cap → collect
 */

import { Effect } from "effect"
import { ConceptState, type ConceptCandidate, type ConceptEngineImpl, type SurfacedConcept } from "@aura/contract"

/** Per-namespace max surfaced concepts, matching Rust MAX_SURFACED_PER_NAMESPACE. */
export const MAX_SURFACED_PER_NAMESPACE = 5

/** Minimum abstraction_score for Candidate concepts to surface. */
export const SURFACE_CANDIDATE_THRESHOLD = 0.70

/** Default global surface limit, matching Rust MAX_SURFACED_CONCEPTS. */
const DEFAULT_LIMIT = 20

// ── Pure surface function (Rust-aligned) ──
// STUB implementation for TDD RED phase.
// Returns empty array — all surface tests will fail.

/**
 * Compute surfaced concepts from a flat array of concept candidates.
 *
 * Pure function matching Rust surface_concepts_filtered() algorithm:
 * 1. Filter eligible: Stable always passes, Candidate needs score >= 0.70
 * 2. Filter namespaces if provided
 * 3. Sort: 5-dim tiebreak (score → confidence → cluster_size → stable priority → key)
 * 4. Dedup by key (first occurrence wins), then per-ns cap, then collect
 * 5. Return SurfacedConcept[]
 *
 * Dedup-before-cap ordering verified against Rust concept.rs lines 1924-1939.
 */
export function computeSurfaceConcepts(
  concepts: ReadonlyArray<ConceptCandidate>,
  namespaces?: ReadonlyArray<string>
): ReadonlyArray<SurfacedConcept> {
  const nsSet = namespaces ? new Set(namespaces) : undefined

  // Phase A: filter eligible concepts
  // Matching Rust surface_concepts_filtered lines 1870-1896
  const eligible = concepts.filter((c) => {
    // Namespace filter
    if (nsSet && !nsSet.has(c.namespace)) return false

    // Must have provenance (matching Rust: non-empty belief_ids and record_ids)
    if (c.belief_ids.length === 0 || c.record_ids.length === 0) return false

    // Must have core_terms or tags (matching Rust)
    if (c.core_terms.length === 0 && c.tags.length === 0) return false

    // State gate: Stable always, Candidate needs score >= threshold, Rejected excluded
    switch (c.state) {
      case ConceptState.Stable:
        return true
      case ConceptState.Candidate:
        return c.abstraction_score >= SURFACE_CANDIDATE_THRESHOLD
      case ConceptState.Rejected:
        return false
      default:
        return false
    }
  })

  // Phase B: sort deterministic 5-dim tiebreak
  // Matching Rust surface_concepts_filtered lines 1900-1917
  eligible.sort((a, b) => {
    // 1. abstraction_score DESC (higher score first)
    const scoreDiff = b.abstraction_score - a.abstraction_score
    if (scoreDiff !== 0) return scoreDiff

    // 2. confidence DESC (higher confidence first)
    const confDiff = b.confidence - a.confidence
    if (confDiff !== 0) return confDiff

    // 3. cluster_size DESC (larger clusters first)
    const sizeDiff = b.belief_ids.length - a.belief_ids.length
    if (sizeDiff !== 0) return sizeDiff

    // 4. Stable before Candidate
    const aStable = a.state === ConceptState.Stable ? 1 : 0
    const bStable = b.state === ConceptState.Stable ? 1 : 0
    const stableDiff = bStable - aStable
    if (stableDiff !== 0) return stableDiff

    // 5. key ASC (deterministic alphabetical tiebreaker)
    if (a.key < b.key) return -1
    if (a.key > b.key) return 1
    return 0
  })

  // Phase C: dedup by key → per-ns cap → collect
  // Matching Rust surface_concepts_filtered lines 1920-1962
  // Dedup-before-cap ordering: duplicates don't consume namespace cap slots
  const result: SurfacedConcept[] = []
  const nsCounts = new Map<string, number>()
  const seenKeys = new Set<string>()

  for (const c of eligible) {
    // Dedup by key — duplicate keys skipped (don't count against cap)
    if (seenKeys.has(c.key)) continue
    seenKeys.add(c.key)

    // Per-namespace cap
    const count = nsCounts.get(c.namespace) ?? 0
    if (count >= MAX_SURFACED_PER_NAMESPACE) continue
    nsCounts.set(c.namespace, count + 1)

    result.push(toSurfacedConcept(c))
  }

  return result
}

// ── Internal ──────────────────────────────────────────────────────────

/** Maps a ConceptCandidate (snake_case contract fields) to SurfacedConcept (camelCase). */
function toSurfacedConcept(c: ConceptCandidate): SurfacedConcept {
  return {
    id: c.id,
    key: c.key,
    state: c.state,
    namespace: c.namespace,
    abstractionScore: c.abstraction_score,
    beliefCount: c.belief_ids.length,
    recordCount: c.record_ids.length,
    coreTerms: c.core_terms,
    recordIds: c.record_ids,
  }
}

// ── Effect-based wrappers (backward compat with existing consumers) ──

/**
 * Returns a sorted, filtered, limited list of surfaced concepts.
 *
 * Wraps computeSurfaceConcepts for backward compat.
 * Existing consumers (EpistemicRuntime) use this Effect-based API.
 */
export function surfaceConcepts(
  engine: ConceptEngineImpl,
  limit?: number
): Effect.Effect<ReadonlyArray<SurfacedConcept>> {
  return Effect.gen(function* () {
    const state = yield* engine.stats()
    const max = limit ?? DEFAULT_LIMIT
    const result = computeSurfaceConcepts(Object.values(state.concepts))
    return result.slice(0, max)
  })
}

/**
 * Same as surfaceConcepts but additionally filters by exact namespace match.
 */
export function surfaceConceptsFiltered(
  engine: ConceptEngineImpl,
  limit?: number,
  namespace?: string
): Effect.Effect<ReadonlyArray<SurfacedConcept>> {
  return Effect.gen(function* () {
    const state = yield* engine.stats()
    const max = limit ?? DEFAULT_LIMIT
    const nsArray = namespace !== undefined ? [namespace] : undefined
    const result = computeSurfaceConcepts(Object.values(state.concepts), nsArray)
    return result.slice(0, max)
  })
}
