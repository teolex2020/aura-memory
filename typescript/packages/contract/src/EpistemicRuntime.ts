import { Tag } from "./Context"
import type { BeliefEngine } from "./Belief"
import type { ConceptEngine } from "./Concept"
import type { CausalEngine } from "./Causal"
import type { PolicyEngine } from "./Policy"
import type { Belief } from "./belief/BeliefTypes"
import type { ConceptCandidate } from "./concept/ConceptTypes"
import type { CausalPattern } from "./causal/CausalTypes"
import type { PolicyHint } from "./policy/PolicyTypes"
import type {
  SurfacedConcept,
  SurfacedPolicyHint,
  BeliefInstabilitySummary,
  ContradictionCluster,
  PolicyLifecycleSummary,
  PolicyPressureArea,
} from "./EpistemicInspection"
import type { Record as AuraRecord } from "./record/Record"
import type { Effect } from "effect"

export namespace EpistemicRuntime {
  /**
   * Read-only cognitive inspection surface.
   *
   * 只读认知检查接口 -- 提供对 belief/concept/causal/policy 层的 inspection 方法。
   */
  export interface Interface {
    // ── Belief layer (6 methods) ──

    /** Get beliefs filtered by state (Resolved/Unresolved/Singleton/Empty). */
    getBeliefs: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine>

    /** Get the belief for a specific record. */
    getBeliefForRecord: (
      recordId: string
    ) => Effect.Effect<Belief | null, never, BeliefEngine>

    /** Get high-volatility beliefs (volatility >= threshold, sorted by volatility desc). */
    getHighVolatilityBeliefs: (
      minVolatility?: number,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine>

    /** Get low-stability beliefs (stability <= threshold, sorted by stability asc). */
    getLowStabilityBeliefs: (
      maxStability?: number,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine>

    /** Aggregated belief health summary (volatility bands, contradiction count). */
    getBeliefInstabilitySummary: () =>
      Effect.Effect<BeliefInstabilitySummary, never, BeliefEngine>

    /** Graph connected components — conflicting belief clusters sharing records/tags. */
    getContradictionClusters: (
      records: ReadonlyMap<string, AuraRecord>,
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<ContradictionCluster>, never, BeliefEngine>

    // ── Concept layer (4 methods) ──

    /** Get concepts filtered by state (Stable/Candidate/Rejected). */
    getConcepts: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<ConceptCandidate>, never, ConceptEngine>

    /** Get surfaced concepts for external consumption (with telemetry counting). */
    getSurfacedConcepts: (
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine>

    /** Get surfaced concepts filtered by namespace. */
    getSurfacedConceptsForNamespace: (
      namespace: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine>

    /** Get surfaced concept annotations for a specific record (limit <= 3). */
    getSurfacedConceptsForRecord: (
      recordId: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine>

    // ── Causal layer (1 method) ──

    /** Get causal patterns filtered by state (Stable/Candidate/Rejected/Invalidated). */
    getCausalPatterns: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<CausalPattern>, never, CausalEngine>

    // ── Policy layer (7 methods) ──

    /** Get policy hints filtered by state (Stable/Candidate/Suppressed/Rejected). */
    getPolicyHints: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine>

    /** Get suppressed policy hints. */
    getSuppressedPolicyHints: (
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine>

    /** Get rejected policy hints. */
    getRejectedPolicyHints: (
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine>

    /** Full policy lifecycle summary — aggregated by actionKind and domain. */
    getPolicyLifecycleSummary: (
      actionLimit?: number,
      domainLimit?: number
    ) => Effect.Effect<PolicyLifecycleSummary, never, PolicyEngine>

    /** Advisory pressure report — namespace+domain pairs sorted by pressure. */
    getPolicyPressureReport: (
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<PolicyPressureArea>, never, PolicyEngine>

    /** Get surfaced policy hints for external consumption. */
    getSurfacedPolicyHints: (
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine>

    /** Get surfaced policy hints filtered by namespace. */
    getSurfacedPolicyHintsForNamespace: (
      namespace: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine>
  }
}

export class EpistemicRuntime extends Tag("aura.contract.EpistemicRuntime")<
  EpistemicRuntime,
  EpistemicRuntime.Interface
>() {}
