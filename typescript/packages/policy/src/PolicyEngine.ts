import { Effect, Layer } from "effect"
import { PolicyEngine } from "@aura/contract"
import type { PolicyEngineState, PolicyReport } from "@aura/contract"
import type { CausalEngineState } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import type { EpistemicTrace } from "@aura/contract"

// Canonical definition now in @aura/contract policy/PolicyTypes.ts
export { PolicyState } from "@aura/contract"

const notImpl = (name: string) => Effect.die(new Error(`PolicyEngineImpl.${name}: not implemented`))

export class PolicyEngineImpl {
  discover(
    _causal_state: CausalEngineState,
    _records: ReadonlyMap<string, AuraRecord>
  ): Effect.Effect<PolicyReport, never, EpistemicTrace> {
    return notImpl("discover") as Effect.Effect<PolicyReport>
  }

  retract_hint(_id: string): Effect.Effect<void> {
    return notImpl("retract_hint")
  }

  stats(): Effect.Effect<PolicyEngineState> {
    return notImpl("stats") as Effect.Effect<PolicyEngineState>
  }
}

export const PolicyEngineLive = Layer.succeed(PolicyEngine, new PolicyEngineImpl())
