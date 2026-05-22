import { Tag } from "./Context"

export type BeliefEngineImpl = {
  with_coarse_key_mode: (mode: unknown) => import("effect").Effect.Effect<void>
  claim_key: (
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string
  ) => import("effect").Effect.Effect<string>
  claim_key_with_mode: (
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string,
    mode: unknown
  ) => import("effect").Effect.Effect<string>
  update: (...args: any[]) => import("effect").Effect.Effect<any>
  update_with_sdr: (...args: any[]) => import("effect").Effect.Effect<any>
  belief_for_record: (record_id: string) => import("effect").Effect.Effect<any>
  deprecate_belief: (belief_id: string) => import("effect").Effect.Effect<void>
  apply_layer_feedback: (...args: any[]) => import("effect").Effect.Effect<any>
  unresolved_beliefs: () => import("effect").Effect.Effect<any>
  stats: () => import("effect").Effect.Effect<any>
}

export class BeliefEngine extends Tag("aura.contract.BeliefEngine")<BeliefEngine, BeliefEngineImpl>() {}

export type BeliefStoreImpl = {
  load: () => import("effect").Effect.Effect<any>
  save: (engine: any) => import("effect").Effect.Effect<void>
}

export class BeliefStore extends Tag("aura.contract.BeliefStore")<BeliefStore, BeliefStoreImpl>() {}
