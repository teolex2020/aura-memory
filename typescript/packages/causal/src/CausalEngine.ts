import { Effect, Layer } from "effect"
import { CausalEngine, UnimplementedError } from "@aura/contract"

export enum CausalState {
  Candidate = "Candidate",
  Stable = "Stable",
  Rejected = "Rejected",
  Invalidated = "Invalidated"
}

export class CausalEngineImpl {
  discover(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "CausalEngineImpl.discover" }))
  }

  invalidate_pattern(_id: string): Effect.Effect<void, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "CausalEngineImpl.invalidate_pattern" }))
  }

  retract_pattern(_id: string): Effect.Effect<void, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "CausalEngineImpl.retract_pattern" }))
  }
}

export const CausalEngineLive = Layer.succeed(CausalEngine, new CausalEngineImpl())
