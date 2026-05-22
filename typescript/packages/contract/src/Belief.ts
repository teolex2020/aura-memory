import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"
import type { BeliefEngineState, BeliefReport } from "./belief/BeliefTypes"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"

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
  update: (
    records: ReadonlyMap<string, AuraRecord>
  ) => import("effect").Effect.Effect<BeliefReport, never, import("./EpistemicTrace").EpistemicTrace>
  update_with_sdr: (
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ) => import("effect").Effect.Effect<BeliefReport, never, import("./EpistemicTrace").EpistemicTrace>
  belief_for_record: (record_id: string) => import("effect").Effect.Effect<string | null>
  deprecate_belief: (belief_id: string) => import("effect").Effect.Effect<void>
  apply_layer_feedback: (...args: unknown[]) => import("effect").Effect.Effect<unknown>
  unresolved_beliefs: () => import("effect").Effect.Effect<ReadonlyArray<string>>
  stats: () => import("effect").Effect.Effect<BeliefEngineState>
}

export class BeliefEngine extends Tag("aura.contract.BeliefEngine")<BeliefEngine, BeliefEngineImpl>() {}

export type BeliefStoreImpl = {
  load: () => import("effect").Effect.Effect<
    BeliefEngineState,
    FileReadError | JsonParseError,
    import("./FileRead").FileRead
  >
  save: (engine: BeliefEngineState) => import("effect").Effect.Effect<void, FileWriteError, import("./FileWrite").FileWrite>
}

export class BeliefStore extends Tag("aura.contract.BeliefStore")<BeliefStore, BeliefStoreImpl>() {}
