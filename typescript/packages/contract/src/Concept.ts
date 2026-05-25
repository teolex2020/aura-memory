import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"
import type { BeliefEngineImpl } from "./Belief"
import type { EpistemicTrace } from "./EpistemicTrace"
import type { ConceptEngineState, ConceptReport, ConceptSeedMode } from "./concept/ConceptTypes"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"

export type ConceptEngineImpl = {
  with_seed_mode: (mode: ConceptSeedMode) => import("effect").Effect.Effect<void>
  discover: (
    belief_engine: BeliefEngineImpl,
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ) => import("effect").Effect.Effect<ConceptReport, never, EpistemicTrace>
  stable_concepts: () => import("effect").Effect.Effect<ReadonlyArray<string>>
  active_candidates: () => import("effect").Effect.Effect<ReadonlyArray<string>>
  stats: () => import("effect").Effect.Effect<ConceptEngineState>
}

export class ConceptEngine extends Tag("aura.contract.ConceptEngine")<ConceptEngine, ConceptEngineImpl>() {}

export type ConceptStoreImpl = {
  load: () =>
    import("effect").Effect.Effect<
      ConceptEngineState,
      FileReadError | JsonParseError,
      import("./FileRead").FileRead
    >
  save: (engine: ConceptEngineState) =>
    import("effect").Effect.Effect<void, FileWriteError, import("./FileWrite").FileWrite>
}

export class ConceptStore extends Tag("aura.contract.ConceptStore")<ConceptStore, ConceptStoreImpl>() {}
