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
  // STUB: RED phase — empty result, all tests will fail
  return []
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
