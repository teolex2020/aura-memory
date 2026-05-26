import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"
import type { BeliefEngineImpl } from "./Belief"
import type { EpistemicTrace } from "./EpistemicTrace"
import type { ConceptEngineState, ConceptReport, ConceptSeedMode } from "./concept/ConceptTypes"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"

import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export type ConceptEngineImpl = {
  with_seed_mode: (mode: ConceptSeedMode) => Effect.Effect<void>
  discover: (
    belief_engine: BeliefEngineImpl,
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ) => Effect.Effect<ConceptReport, never, EpistemicTrace>
  stable_concepts: () => Effect.Effect<ReadonlyArray<string>>
  active_candidates: () => Effect.Effect<ReadonlyArray<string>>
  stats: () => Effect.Effect<ConceptEngineState>
}

export class ConceptEngine extends Tag("aura.contract.ConceptEngine")<ConceptEngine, ConceptEngineImpl>() {}

export type ConceptStoreImpl = {
  load: () =>
    Effect.Effect<
      ConceptEngineState,
      FileReadError | JsonParseError,
      FileRead
    >
  save: (engine: ConceptEngineState) =>
    Effect.Effect<void, FileWriteError, FileWrite>
}

export class ConceptStore extends Tag("aura.contract.ConceptStore")<ConceptStore, ConceptStoreImpl>() {}
