import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"
import type { BeliefEngineState, BeliefReport } from "./belief/BeliefTypes"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"

import type { EpistemicTrace } from "./EpistemicTrace"
import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export type BeliefEngineImpl = {
  with_coarse_key_mode: (mode: unknown) => Effect.Effect<void>
  claim_key: (
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string
  ) => Effect.Effect<string>
  claim_key_with_mode: (
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string,
    mode: unknown
  ) => Effect.Effect<string>
  update: (
    records: ReadonlyMap<string, AuraRecord>
  ) => Effect.Effect<BeliefReport, never, EpistemicTrace>
  update_with_sdr: (
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ) => Effect.Effect<BeliefReport, never, EpistemicTrace>
  belief_for_record: (record_id: string) => Effect.Effect<string | null>
  deprecate_belief: (belief_id: string) => Effect.Effect<void>
  apply_layer_feedback: (...args: unknown[]) => Effect.Effect<unknown>
  unresolved_beliefs: () => Effect.Effect<ReadonlyArray<string>>
  stats: () => Effect.Effect<BeliefEngineState>
}

export class BeliefEngine extends Tag("aura.contract.BeliefEngine")<BeliefEngine, BeliefEngineImpl>() {}

export type BeliefStoreImpl = {
  load: () => Effect.Effect<
    BeliefEngineState,
    FileReadError | JsonParseError,
    FileRead
  >
  save: (engine: BeliefEngineState) => Effect.Effect<void, FileWriteError, FileWrite>
}

export class BeliefStore extends Tag("aura.contract.BeliefStore")<BeliefStore, BeliefStoreImpl>() {}
