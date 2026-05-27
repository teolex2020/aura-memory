import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError } from "./Errors"

import type { CausalEngineState } from "./causal/CausalTypes"
import type { PolicyEngineState, PolicyReport } from "./policy/PolicyTypes"
import type { EpistemicTrace } from "./EpistemicTrace"
import type { Record as AuraRecord } from "./record/Record"

import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export type PolicyEngineImpl = {
  discover: (
    causal_state: CausalEngineState,
    records: ReadonlyMap<string, AuraRecord>
  ) => Effect.Effect<PolicyReport, never, EpistemicTrace>
  retract_hint: (id: string) => Effect.Effect<void>
  stats: () => Effect.Effect<PolicyEngineState>
}

export class PolicyEngine extends Tag("aura.contract.PolicyEngine")<PolicyEngine, PolicyEngineImpl>() {}

export type PolicyStoreImpl = {
  load: () =>
    Effect.Effect<
      PolicyEngineState,
      FileReadError | JsonParseError,
      FileRead
    >
  save: (engine: PolicyEngineState) =>
    Effect.Effect<void, FileWriteError, FileWrite>
}

export class PolicyStore extends Tag("aura.contract.PolicyStore")<PolicyStore, PolicyStoreImpl>() {}
