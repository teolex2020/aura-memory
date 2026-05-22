import { Effect, Layer } from "effect"
import { PolicyEngine } from "@aura/contract"

export type PolicyState = "Candidate" | "Stable" | "Suppressed" | "Rejected"

export class PolicyEngineImpl {
  discover(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: PolicyEngineImpl.discover"))
  }

  retract_hint(_id: string): Effect.Effect<void> {
    return Effect.die(new Error("TODO: PolicyEngineImpl.retract_hint"))
  }
}

export const PolicyEngineLive = Layer.succeed(PolicyEngine, new PolicyEngineImpl())

