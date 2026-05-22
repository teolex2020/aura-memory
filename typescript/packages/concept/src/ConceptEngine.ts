import { Effect, Layer } from "effect"
import { ConceptEngine } from "@aura/contract"

export type ConceptState = "Stable" | "Candidate" | "Rejected"

export class ConceptEngineImpl {
  with_seed_mode(_mode: unknown): Effect.Effect<void> {
    return Effect.die(new Error("TODO: ConceptEngineImpl.with_seed_mode"))
  }

  discover(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: ConceptEngineImpl.discover"))
  }

  stable_concepts(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: ConceptEngineImpl.stable_concepts"))
  }

  active_candidates(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: ConceptEngineImpl.active_candidates"))
  }

  stats(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: ConceptEngineImpl.stats"))
  }
}

export const ConceptEngineLive = Layer.succeed(ConceptEngine, new ConceptEngineImpl())

