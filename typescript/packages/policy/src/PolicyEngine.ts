import { Effect, Layer } from "effect"
import { PolicyEngine, UnimplementedError } from "@aura/contract"

export enum PolicyState {
  Candidate = "Candidate",
  Stable = "Stable",
  Suppressed = "Suppressed",
  Rejected = "Rejected"
}

export class PolicyEngineImpl {
  discover(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "PolicyEngineImpl.discover" }))
  }

  retract_hint(_id: string): Effect.Effect<void, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "PolicyEngineImpl.retract_hint" }))
  }
}

export const PolicyEngineLive = Layer.succeed(PolicyEngine, new PolicyEngineImpl())
