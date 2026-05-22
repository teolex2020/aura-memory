import { Effect, Layer } from "effect"
import { CausalEngine } from "@aura/contract"

export type CausalState = "Candidate" | "Stable" | "Rejected" | "Invalidated"

export class CausalEngineImpl {
  discover(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: CausalEngineImpl.discover"))
  }

  invalidate_pattern(_id: string): Effect.Effect<void> {
    return Effect.die(new Error("TODO: CausalEngineImpl.invalidate_pattern"))
  }

  retract_pattern(_id: string): Effect.Effect<void> {
    return Effect.die(new Error("TODO: CausalEngineImpl.retract_pattern"))
  }
}

export const CausalEngineLive = Layer.succeed(CausalEngine, new CausalEngineImpl())

