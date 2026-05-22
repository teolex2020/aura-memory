import { Effect, Layer } from "effect"
import { EpistemicRuntime } from "@aura/contract"

export class EpistemicRuntimeImpl {
  get_beliefs(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: EpistemicRuntimeImpl.get_beliefs"))
  }

  get_concepts(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: EpistemicRuntimeImpl.get_concepts"))
  }

  get_causal_patterns(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: EpistemicRuntimeImpl.get_causal_patterns"))
  }

  get_policy_hints(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: EpistemicRuntimeImpl.get_policy_hints"))
  }

  get_surfaced_concepts(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: EpistemicRuntimeImpl.get_surfaced_concepts"))
  }

  get_surfaced_policy_hints(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: EpistemicRuntimeImpl.get_surfaced_policy_hints"))
  }
}

export const EpistemicRuntimeLive = Layer.succeed(EpistemicRuntime, new EpistemicRuntimeImpl())

