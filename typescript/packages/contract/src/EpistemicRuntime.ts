import { Tag } from "./Context"
import type { BeliefEngine } from "./Belief"
import type { ConceptEngine } from "./Concept"
import type { CausalEngine } from "./Causal"
import type { PolicyEngine } from "./Policy"
import type { BeliefEngineState } from "./belief/BeliefTypes"
import type { ConceptEngineState } from "./concept/ConceptTypes"
import type { CausalEngineState } from "./causal/CausalTypes"
import type { CausalReport } from "./causal/CausalTypes"
import type { PolicyEngineState } from "./policy/PolicyTypes"
import type { PolicyReport } from "./policy/PolicyTypes"
import type { BeliefReport } from "./belief/BeliefTypes"
import type { ConceptReport } from "./concept/ConceptTypes"
import type { SdrLookup } from "./sdr/Sdr"
import type { Record as AuraRecord } from "./record/Record"
import type { EpistemicTrace } from "./EpistemicTrace"

import type { Effect } from "effect"

export type EpistemicReport = {
  readonly belief: BeliefReport
  readonly concept: ConceptReport
  readonly causal: CausalReport
  readonly policy: PolicyReport
}

export type EpistemicRuntimeImpl = {
  maintain: (
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ) => Effect.Effect<EpistemicReport, never, EpistemicTrace | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine>
  get_beliefs: () => Effect.Effect<BeliefEngineState, never, BeliefEngine>
  get_concepts: () => Effect.Effect<ConceptEngineState, never, ConceptEngine>
  get_causal_patterns: () => Effect.Effect<CausalEngineState, never, CausalEngine>
  get_policy_hints: () => Effect.Effect<PolicyEngineState, never, PolicyEngine>
  get_surfaced_concepts: (...args: unknown[]) => Effect.Effect<unknown>
  get_surfaced_policy_hints: (...args: unknown[]) => Effect.Effect<unknown>
}

export class EpistemicRuntime extends Tag("aura.contract.EpistemicRuntime")<
  EpistemicRuntime,
  EpistemicRuntimeImpl
>() {}
