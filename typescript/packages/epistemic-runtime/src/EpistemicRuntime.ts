import { Effect, Layer } from "effect"
import { EpistemicRuntime } from "@aura/contract"
import type { BeliefEngineState } from "@aura/contract"
import type { ConceptEngineState } from "@aura/contract"
import type { CausalEngineState } from "@aura/contract"
import type { PolicyEngineState } from "@aura/contract"
import type { EpistemicReport } from "@aura/contract"
import type { SdrLookup } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import type { EpistemicTrace } from "@aura/contract"

const notImpl = (name: string) => Effect.die(new Error(`EpistemicRuntimeImpl.${name}: not implemented`))

export class EpistemicRuntimeImpl {
  maintain(
    _records: ReadonlyMap<string, AuraRecord>,
    _sdr_lookup: SdrLookup
  ): Effect.Effect<EpistemicReport, never, EpistemicTrace> {
    return notImpl("maintain") as Effect.Effect<EpistemicReport>
  }

  get_beliefs(): Effect.Effect<BeliefEngineState> {
    return notImpl("get_beliefs") as Effect.Effect<BeliefEngineState>
  }

  get_concepts(): Effect.Effect<ConceptEngineState> {
    return notImpl("get_concepts") as Effect.Effect<ConceptEngineState>
  }

  get_causal_patterns(): Effect.Effect<CausalEngineState> {
    return notImpl("get_causal_patterns") as Effect.Effect<CausalEngineState>
  }

  get_policy_hints(): Effect.Effect<PolicyEngineState> {
    return notImpl("get_policy_hints") as Effect.Effect<PolicyEngineState>
  }

  get_surfaced_concepts(..._args: unknown[]): Effect.Effect<unknown> {
    return notImpl("get_surfaced_concepts") as Effect.Effect<unknown>
  }

  get_surfaced_policy_hints(..._args: unknown[]): Effect.Effect<unknown> {
    return notImpl("get_surfaced_policy_hints") as Effect.Effect<unknown>
  }
}

export const EpistemicRuntimeLive = Layer.succeed(EpistemicRuntime, new EpistemicRuntimeImpl())
