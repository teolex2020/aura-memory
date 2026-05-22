import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError, UnimplementedError } from "./Errors"

export type BeliefEngineImpl = {
  with_coarse_key_mode: (mode: unknown) => import("effect").Effect.Effect<void, UnimplementedError>
  claim_key: (
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string
  ) => import("effect").Effect.Effect<string, UnimplementedError>
  claim_key_with_mode: (
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string,
    mode: unknown
  ) => import("effect").Effect.Effect<string, UnimplementedError>
  update: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  update_with_sdr: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  belief_for_record: (record_id: string) => import("effect").Effect.Effect<unknown, UnimplementedError>
  deprecate_belief: (belief_id: string) => import("effect").Effect.Effect<void, UnimplementedError>
  apply_layer_feedback: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  unresolved_beliefs: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  stats: () => import("effect").Effect.Effect<unknown, UnimplementedError>
}

export class BeliefEngine extends Tag("aura.contract.BeliefEngine")<BeliefEngine, BeliefEngineImpl>() {}

export type BeliefStoreImpl = {
  load: () => import("effect").Effect.Effect<unknown, FileReadError | JsonParseError, import("./FileRead").FileRead>
  save: (engine: unknown) => import("effect").Effect.Effect<void, FileWriteError, import("./FileWrite").FileWrite>
}

export class BeliefStore extends Tag("aura.contract.BeliefStore")<BeliefStore, BeliefStoreImpl>() {}
