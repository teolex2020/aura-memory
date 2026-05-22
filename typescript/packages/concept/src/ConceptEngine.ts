import { Effect, Layer } from "effect"
import { ConceptEngine, UnimplementedError } from "@aura/contract"

export type ConceptState = "Stable" | "Candidate" | "Rejected"

export class ConceptEngineImpl {
  with_seed_mode(_mode: unknown): Effect.Effect<void, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "ConceptEngineImpl.with_seed_mode" }))
  }

  discover(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "ConceptEngineImpl.discover" }))
  }

  stable_concepts(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "ConceptEngineImpl.stable_concepts" }))
  }

  active_candidates(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "ConceptEngineImpl.active_candidates" }))
  }

  stats(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "ConceptEngineImpl.stats" }))
  }
}

export const ConceptEngineLive = Layer.succeed(ConceptEngine, new ConceptEngineImpl())
