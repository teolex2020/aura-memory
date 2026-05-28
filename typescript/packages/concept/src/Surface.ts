/**
 * Concept surface functions.
 *
 * Filters disclosed concepts (Stable or Candidate state), sorts by abstraction
 * score descending, limits the result set, and maps each candidate into a
 * SurfacedConcept ready for external consumption.
 *
 * Aligns with Rust `concept.rs` §surface module:
 *   - Phase A: filter eligible concepts (state = Stable or Candidate)
 *   - Phase B: optional namespace filter
 *   - Phase C: sort by abstraction_score desc, then key asc (deterministic)
 *   - Phase D: limit (default 20, no max cap)
 *   - Phase E: map to SurfacedConcept
 */
import { Effect } from "effect"
import { ConceptState, type ConceptEngineImpl, type SurfacedConcept } from "@aura/contract"

/** Default surface limit, matching Rust MAX_SURFACED_CONCEPTS. */
const DEFAULT_LIMIT = 20

/**
 * Returns a sorted, filtered, limited list of surfaced concepts.
 *
 * Filters to Stable and Candidate concepts, sorts by abstraction score
 * descending (with key ascending as tiebreaker), caps at the given limit
 * (default 20), and maps each candidate to a SurfacedConcept.
 *
 * Empty engine state returns an empty array — no crash, no error.
 */
export function surfaceConcepts(
  engine: ConceptEngineImpl,
  limit?: number
): Effect.Effect<ReadonlyArray<SurfacedConcept>> {
  return Effect.gen(function* () {
    const state = yield* engine.stats()
    const max = limit ?? DEFAULT_LIMIT

    const result = Object.values(state.concepts)
      .filter(
        (c) => c.state === ConceptState.Stable || c.state === ConceptState.Candidate
      )
      .sort((a, b) => {
        const scoreDiff = b.abstraction_score - a.abstraction_score
        if (scoreDiff !== 0) return scoreDiff
        // Secondary sort by key ascending for deterministic ordering
        if (a.key < b.key) return -1
        if (a.key > b.key) return 1
        return 0
      })
      .slice(0, max)
      .map(toSurfacedConcept)

    return result
  })
}

/**
 * Same as surfaceConcepts but additionally filters by exact namespace match.
 *
 * When namespace is not provided, behaves identically to surfaceConcepts.
 * A non-existent namespace returns an empty array.
 */
export function surfaceConceptsFiltered(
  engine: ConceptEngineImpl,
  limit?: number,
  namespace?: string
): Effect.Effect<ReadonlyArray<SurfacedConcept>> {
  return Effect.gen(function* () {
    const state = yield* engine.stats()
    const max = limit ?? DEFAULT_LIMIT

    let candidates = Object.values(state.concepts).filter(
      (c) => c.state === ConceptState.Stable || c.state === ConceptState.Candidate
    )

    if (namespace !== undefined) {
      candidates = candidates.filter((c) => c.namespace === namespace)
    }

    const result = candidates
      .sort((a, b) => {
        const scoreDiff = b.abstraction_score - a.abstraction_score
        if (scoreDiff !== 0) return scoreDiff
        if (a.key < b.key) return -1
        if (a.key > b.key) return 1
        return 0
      })
      .slice(0, max)
      .map(toSurfacedConcept)

    return result
  })
}

// ── Internal ──────────────────────────────────────────────────────────

/** Maps a ConceptCandidate (snake_case contract fields) to SurfacedConcept (camelCase). */
function toSurfacedConcept(c: {
  readonly id: string
  readonly key: string
  readonly state: string
  readonly namespace: string
  readonly abstraction_score: number
  readonly belief_ids: ReadonlyArray<string>
  readonly record_ids: ReadonlyArray<string>
  readonly core_terms: ReadonlyArray<string>
}): SurfacedConcept {
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
