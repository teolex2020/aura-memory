import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"

import type { ConceptEngineState } from "./concept/ConceptTypes"
import type { CausalEngineState, CausalReport } from "./causal/CausalTypes"
import type { EpistemicTrace } from "./EpistemicTrace"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"

import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export type CausalEngineImpl = {
  discover: (
    concept_state: ConceptEngineState,
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ) => Effect.Effect<CausalReport, never, EpistemicTrace>
  invalidate_pattern: (id: string) => Effect.Effect<void>
  retract_pattern: (id: string) => Effect.Effect<void>
  stats: () => Effect.Effect<CausalEngineState>
}

export class CausalEngine extends Tag("aura.contract.CausalEngine")<CausalEngine, CausalEngineImpl>() {}

export type CausalStoreImpl = {
  load: () =>
    Effect.Effect<
      CausalEngineState,
      FileReadError | JsonParseError,
      FileRead
    >
  save: (engine: CausalEngineState) =>
    Effect.Effect<void, FileWriteError, FileWrite>
}

export class CausalStore extends Tag("aura.contract.CausalStore")<CausalStore, CausalStoreImpl>() {}
