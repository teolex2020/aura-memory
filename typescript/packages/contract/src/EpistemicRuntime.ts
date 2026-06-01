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
   *
   * Rust reference: `EpistemicRuntime` in `../src/epistemic_runtime.rs`.
   */
  export interface Interface {
    // ── Belief layer (6 methods) ──

    /**
     * Get beliefs filtered by state (Resolved/Unresolved/Singleton/Empty).
     * Returns all beliefs when no filter is provided.
     *
     * 按状态过滤 beliefs（Resolved/Unresolved/Singleton/Empty），不传 filter 返回全部。
     *
     * Rust reference: `EpistemicRuntime::get_beliefs` in `../src/epistemic_runtime.rs`.
     */
    getBeliefs: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine>

    /**
     * Get the belief for a specific record by resolving through the belief→record index.
     * Returns null when the record has no associated belief.
     *
     * 通过 belief→record 索引查询指定 record 对应的 belief，无关联时返回 null。
     *
     * Rust reference: `EpistemicRuntime::get_belief_for_record` in `../src/epistemic_runtime.rs`.
     */
    getBeliefForRecord: (
      recordId: string
    ) => Effect.Effect<Belief | null, never, BeliefEngine>

    /**
     * Get high-volatility beliefs (volatility >= threshold, sorted by volatility desc).
     * Default minVolatility=0.20, limit=20 (max 100).
     *
     * 获取高波动性 beliefs（volatility >= 阈值，按 volatility 降序），默认阈值 0.20、limit 20（上限 100）。
     *
     * Rust reference: `EpistemicRuntime::get_high_volatility_beliefs` in `../src/epistemic_runtime.rs`.
     */
    getHighVolatilityBeliefs: (
      minVolatility?: number,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine>

    /**
     * Get low-stability beliefs (stability <= threshold, sorted by stability asc).
     * Default maxStability=1.0, limit=20 (max 100).
     *
     * 获取低稳定性 beliefs（stability <= 阈值，按 stability 升序），默认阈值 1.0、limit 20（上限 100）。
     *
     * Rust reference: `EpistemicRuntime::get_low_stability_beliefs` in `../src/epistemic_runtime.rs`.
     */
    getLowStabilityBeliefs: (
      maxStability?: number,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine>

    /**
     * Aggregated belief health summary: state counts, volatility/stability averages,
     * volatility bands (low/medium/high), and contradiction cluster count.
     *
     * 聚合信念健康摘要：状态计数、volatility/stability 均值、波动性分带（低/中/高）、矛盾簇数量。
     *
     * Rust reference: `EpistemicRuntime::get_belief_instability_summary` in `../src/epistemic_runtime.rs`.
     */
    getBeliefInstabilitySummary: (
      records: ReadonlyMap<string, AuraRecord>
    ) =>
      Effect.Effect<BeliefInstabilitySummary, never, BeliefEngine>

    /**
     * Graph connected components over beliefs — conflicting belief clusters sharing
     * records or tags within the same namespace. Sorted by avgVolatility desc,
     * totalConflictMass desc, then cluster size.
     * Default limit=20 (max 100).
     *
     * 基于图连通分量的矛盾簇检测：同一 namespace 内共享 record 或 tag 的冲突 belief 聚簇，
     * 按 avgVolatility 降序、totalConflictMass 降序、簇大小排序。默认 limit=20（上限 100）。
     *
     * Rust reference: `EpistemicRuntime::get_contradiction_clusters` in `../src/epistemic_runtime.rs`.
     */
    getContradictionClusters: (
      records: ReadonlyMap<string, AuraRecord>,
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<ContradictionCluster>, never, BeliefEngine>

    // ── Concept layer (4 methods) ──

    /**
     * Get concepts filtered by state (Stable/Candidate/Rejected).
     * Returns all concepts when no filter is provided.
     *
     * 按状态过滤 concepts（Stable/Candidate/Rejected），不传 filter 返回全部。
     *
     * Rust reference: `EpistemicRuntime::get_concepts` in `../src/epistemic_runtime.rs`.
     */
    getConcepts: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<ConceptCandidate>, never, ConceptEngine>

    /**
     * Get surfaced concepts for external consumption with telemetry counting.
     * Returns empty array when conceptSurfaceMode is disabled.
     *
     * 获取对外暴露的 surfaced concepts，附带遥测计数。conceptSurfaceMode 关闭时返回空数组。
     *
     * Rust reference: `EpistemicRuntime::get_surfaced_concepts` in `../src/epistemic_runtime.rs`.
     */
    getSurfacedConcepts: (
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine>

    /**
     * Get surfaced concepts filtered by namespace with telemetry counting.
     * Returns empty array when conceptSurfaceMode is disabled.
     *
     * 按 namespace 过滤 surfaced concepts，附带遥测计数。conceptSurfaceMode 关闭时返回空数组。
     *
     * Rust reference: `EpistemicRuntime::get_surfaced_concepts_for_namespace` in `../src/epistemic_runtime.rs`.
     */
    getSurfacedConceptsForNamespace: (
      namespace: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine>

    /**
     * Get surfaced concept annotations for a specific record (limit clamped to 1–3, default 3).
     * Returns empty array when conceptSurfaceMode is disabled.
     *
     * 获取指定 record 的 surfaced concept 标注（limit 钳制在 1–3，默认 3）。conceptSurfaceMode 关闭时返回空数组。
     *
     * Rust reference: `EpistemicRuntime::get_surfaced_concepts_for_record` in `../src/epistemic_runtime.rs`.
     */
    getSurfacedConceptsForRecord: (
      recordId: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine>

    // ── Causal layer (1 method) ──

    /**
     * Get causal patterns filtered by state (Stable/Candidate/Rejected/Invalidated).
     * Returns all patterns when no filter is provided.
     *
     * 按状态过滤因果模式（Stable/Candidate/Rejected/Invalidated），不传 filter 返回全部。
     *
     * Rust reference: `EpistemicRuntime::get_causal_patterns` in `../src/epistemic_runtime.rs`.
     */
    getCausalPatterns: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<CausalPattern>, never, CausalEngine>

    // ── Policy layer (7 methods) ──

    /**
     * Get policy hints filtered by state (Stable/Candidate/Suppressed/Rejected).
     * Returns all hints when no filter is provided.
     *
     * 按状态过滤 policy hints（Stable/Candidate/Suppressed/Rejected），不传 filter 返回全部。
     *
     * Rust reference: `EpistemicRuntime::get_policy_hints` in `../src/epistemic_runtime.rs`.
     */
    getPolicyHints: (
      stateFilter?: string
    ) => Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine>

    /**
     * Get suppressed policy hints, optionally filtered by namespace.
     * Sorted by policyStrength desc, then cause_key asc. Default limit=20 (max 100).
     *
     * 获取被抑制的 policy hints，可按 namespace 过滤。按 policyStrength 降序、cause_key 升序排列。默认 limit=20（上限 100）。
     *
     * Rust reference: `EpistemicRuntime::get_suppressed_policy_hints` in `../src/epistemic_runtime.rs`.
     */
    getSuppressedPolicyHints: (
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine>

    /**
     * Get rejected policy hints, optionally filtered by namespace.
     * Sorted by policyStrength desc, then cause_key asc. Default limit=20 (max 100).
     *
     * 获取被拒绝的 policy hints，可按 namespace 过滤。按 policyStrength 降序、cause_key 升序排列。默认 limit=20（上限 100）。
     *
     * Rust reference: `EpistemicRuntime::get_rejected_policy_hints` in `../src/epistemic_runtime.rs`.
     */
    getRejectedPolicyHints: (
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine>

    /**
     * Full policy lifecycle summary — aggregated by actionKind and (namespace, domain).
     * Includes state counts, avgPolicyStrength, avgRiskScore, and advisoryPressure per domain.
     * Default actionLimit=8 (max 16), domainLimit=12 (max 32).
     *
     * 完整策略生命周期摘要：按 actionKind 和 (namespace, domain) 聚合，
     * 包含各状态计数、avgPolicyStrength、avgRiskScore 及每 domain 的 advisoryPressure。
     * 默认 actionLimit=8（上限 16）、domainLimit=12（上限 32）。
     *
     * Rust reference: `EpistemicRuntime::get_policy_lifecycle_summary` in `../src/epistemic_runtime.rs`.
     */
    getPolicyLifecycleSummary: (
      actionLimit?: number,
      domainLimit?: number
    ) => Effect.Effect<PolicyLifecycleSummary, never, PolicyEngine>

    /**
     * Advisory pressure report — namespace+domain pairs sorted by advisoryPressure desc.
     * Advisory pressure weights: Avoid=1.30, Warn=1.15, VerifyFirst=1.00, Recommend=0.85, Prefer=0.75.
     * Only active (Stable/Candidate) hints contribute to pressure. Default limit=10 (max 25).
     *
     * 策略压力报告：按 advisoryPressure 降序排列的 namespace+domain 对。
     * 压力权重：Avoid=1.30、Warn=1.15、VerifyFirst=1.00、Recommend=0.85、Prefer=0.75。
     * 仅活跃（Stable/Candidate）hints 计入压力。默认 limit=10（上限 25）。
     *
     * Rust reference: `EpistemicRuntime::get_policy_pressure_report` in `../src/epistemic_runtime.rs`.
     */
    getPolicyPressureReport: (
      namespace?: string,
      limit?: number
    ) => Effect.Effect<ReadonlyArray<PolicyPressureArea>, never, PolicyEngine>

    /**
     * Get surfaced policy hints for external consumption (all namespaces).
     *
     * 获取对外暴露的 surfaced policy hints（所有 namespace）。
     *
     * Rust reference: `EpistemicRuntime::get_surfaced_policy_hints` in `../src/epistemic_runtime.rs`.
     */
    getSurfacedPolicyHints: (
      limit?: number
    ) => Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine>

    /**
     * Get surfaced policy hints filtered by namespace.
     *
     * 按 namespace 过滤 surfaced policy hints。
     *
     * Rust reference: `EpistemicRuntime::get_surfaced_policy_hints_for_namespace` in `../src/epistemic_runtime.rs`.
     */
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
