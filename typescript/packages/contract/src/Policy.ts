import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"

import type { CausalEngine } from "./Causal"
import type { BeliefEngine } from "./Belief"
import type { ConceptEngine } from "./Concept"
import type { PolicyEngineState, PolicyReport } from "./policy/PolicyTypes"
import type { EpistemicTrace } from "./EpistemicTrace"
import type { Record as AuraRecord } from "./record/Record"

import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export namespace PolicyEngine {
  export interface Interface {
    discover: (
      causal_engine: CausalEngine.Interface,
      concept_engine: ConceptEngine.Interface,
      belief_engine: BeliefEngine.Interface,
      records: ReadonlyMap<string, AuraRecord>
    ) => Effect.Effect<PolicyReport, never, EpistemicTrace>
    retract_hint: (id: string) => Effect.Effect<void>
    stats: () => Effect.Effect<PolicyEngineState>
  }
}

export class PolicyEngine extends Tag("aura.contract.PolicyEngine")<PolicyEngine, PolicyEngine.Interface>() {}

/** @deprecated Use PolicyEngine.Interface instead. */
export type PolicyEngineImpl = PolicyEngine.Interface

export namespace PolicyStore {
  export interface Interface {
    load: () =>
      Effect.Effect<
        PolicyEngineState,
        FileReadError | JsonParseError,
        FileRead
      >
    save: (engine: PolicyEngineState) =>
      Effect.Effect<void, FileWriteError, FileWrite>
  }
}

export class PolicyStore extends Tag("aura.contract.PolicyStore")<PolicyStore, PolicyStore.Interface>() {}

/** @deprecated Use PolicyStore.Interface instead. */
export type PolicyStoreImpl = PolicyStore.Interface
