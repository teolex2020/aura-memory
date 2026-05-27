import { Effect, Layer } from "effect"
import { CausalEngine } from "@aura/contract"
import type { CausalEngineState, CausalReport } from "@aura/contract"
import type { ConceptEngineState } from "@aura/contract"
import type { SdrLookup } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import type { EpistemicTrace } from "@aura/contract"

// Canonical definition now in @aura/contract causal/CausalTypes.ts
export { CausalState } from "@aura/contract"

const notImpl = (name: string) => Effect.die(new Error(`CausalEngineImpl.${name}: not implemented`))

export class CausalEngineImpl {
  discover(
    _concept_state: ConceptEngineState,
    _records: ReadonlyMap<string, AuraRecord>,
    _sdr_lookup: SdrLookup
  ): Effect.Effect<CausalReport, never, EpistemicTrace> {
    return notImpl("discover") as Effect.Effect<CausalReport>
  }

  invalidate_pattern(_id: string): Effect.Effect<void> {
    return notImpl("invalidate_pattern")
  }

  retract_pattern(_id: string): Effect.Effect<void> {
    return notImpl("retract_pattern")
  }

  stats(): Effect.Effect<CausalEngineState> {
    return notImpl("stats") as Effect.Effect<CausalEngineState>
  }
}

export const CausalEngineLive = Layer.succeed(CausalEngine, new CausalEngineImpl())
