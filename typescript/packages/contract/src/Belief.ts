import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"
import type { BeliefEngineState, BeliefReport } from "./belief/BeliefTypes"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"
import type { EpistemicTrace } from "./EpistemicTrace"
import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export namespace BeliefEngine {
  /**
   * Belief engine service interface — maintains the full belief layer state
   * (Belief/Hypothesis/Record→Belief index) from records during each maintenance cycle.
   *
   * Belief 引擎服务接口：在维护周期中从 records 构建并维护完整的信念层状态
   *（Belief/Hypothesis/索引）。
   */
  export interface Interface {
    /**
     * Controls how the coarse belief key is constructed before SDR subclustering.
     *
     * 设置 coarse key 的构造模式（在 SDR 子聚类前，先按 key 分桶）。
     */
    with_coarse_key_mode: (mode: unknown) => Effect.Effect<void>

    /**
     * Canonical claim key for a record (using current coarseKeyMode).
     *
     * 生成 claim key（使用当前 coarseKeyMode）。
     */
    claim_key: (
      namespace: string,
      tags: ReadonlyArray<string>,
      semantic_type: string
    ) => Effect.Effect<string>

    /**
     * Canonical claim key for a record (explicit mode).
     * Dispatches on CoarseKeyMode: Standard, TopOneTag, SemanticOnly, TagFamily variants,
     * DualKey, NeighborhoodPool, BridgeKey, SdrTagPool.
     *
     * 生成 claim key（显式传入 mode），根据 CoarseKeyMode 分派不同策略。
     */
    claim_key_with_mode: (
      namespace: string,
      tags: ReadonlyArray<string>,
      semantic_type: string,
      mode: unknown
    ) => Effect.Effect<string>

    /**
     * Run a full belief update cycle over all records (without SDR data).
     * Delegates to update_with_sdr with empty SDR lookup.
     *
     * 跑一轮 belief 全量更新（无 SDR 时的 fallback 路径）。
     */
    update: (
      records: ReadonlyMap<string, AuraRecord>
    ) => Effect.Effect<BeliefReport, never, EpistemicTrace>

    /**
     * Run a full belief update cycle with SDR-backed claim grouping:
     * 1) Group records by claim key (namespace + tags + semantic_type)
     * 2) Within each group, split into SDR sub-clusters via Union-Find
     *    (Tanimoto ≥ SDR_TANIMOTO_THRESHOLD → same claim)
     * 3) Build one Hypothesis per sub-cluster, resolve winner / unresolved per Belief
     *
     * 跑一轮 belief 全量更新（带 SDR 分组）：
     * 1) 按 claim key 分桶（namespace + tags + semantic_type）
     * 2) 在桶内按 SDR Tanimoto ≥ threshold 合并成子簇（Union-Find）
     * 3) 每个子簇构建 hypothesis，并在同一 belief 内 resolve winner / unresolved
     */
    update_with_sdr: (
      records: ReadonlyMap<string, AuraRecord>,
      sdr_lookup: SdrLookup
    ) => Effect.Effect<BeliefReport, never, EpistemicTrace>

    /**
     * Lookup belief id for a given record id.
     * Used by downstream indexing, interpretation, and reranking layers.
     *
     * 查询 record 属于哪个 belief（用于下游索引/解释/rerank）。
     */
    belief_for_record: (record_id: string) => Effect.Effect<string | null>

    /**
     * Deprecate a belief — removes belief, its hypotheses, and record mappings from state.
     *
     * 废弃指定 belief：从状态中移除 belief、其 hypotheses 及 record 映射。
     */
    deprecate_belief: (belief_id: string) => Effect.Effect<void>

    /**
     * Apply higher-layer feedback (corrections/policy pressure).
     * Accepts: { belief_id, action: "boost"|"suppress"|"deprecate", factor?: number }
     * - boost: increments stability by factor (rounded)
     * - suppress: increments volatility by factor
     * - deprecate: removes belief and its hypotheses
     *
     * 应用更高层反馈：接受 { belief_id, action, factor? }，对目标 belief 施加修正。
     */
    apply_layer_feedback: (...args: unknown[]) => Effect.Effect<unknown>

    /**
     * List belief ids currently in Unresolved state.
     * Used to surface areas with insufficient evidence or unresolved conflicts.
     *
     * 返回当前所有 Unresolved beliefs（用于提示"证据不足/冲突未解"的区域）。
     */
    unresolved_beliefs: () => Effect.Effect<ReadonlyArray<string>>

    /**
     * Return current engine state snapshot (for persistence and downstream layers).
     *
     * 返回引擎当前状态快照（用于持久化与下游层）。
     */
    stats: () => Effect.Effect<BeliefEngineState>
  }
}

export class BeliefEngine extends Tag("aura.contract.BeliefEngine")<BeliefEngine, BeliefEngine.Interface>() {}

export type BeliefStoreImpl = {
  load: () => Effect.Effect<
    BeliefEngineState,
    FileReadError | JsonParseError,
    FileRead
  >
  save: (engine: BeliefEngineState) => Effect.Effect<void, FileWriteError, FileWrite>
}

export class BeliefStore extends Tag("aura.contract.BeliefStore")<BeliefStore, BeliefStoreImpl>() {}
