import { Effect, Layer } from "effect"
import { EpistemicRuntime, UnimplementedError } from "@aura/contract"

export class EpistemicRuntimeImpl {
  get_beliefs(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "EpistemicRuntimeImpl.get_beliefs" }))
  }

  get_concepts(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "EpistemicRuntimeImpl.get_concepts" }))
  }

  get_causal_patterns(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "EpistemicRuntimeImpl.get_causal_patterns" }))
  }

  get_policy_hints(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "EpistemicRuntimeImpl.get_policy_hints" }))
  }

  get_surfaced_concepts(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "EpistemicRuntimeImpl.get_surfaced_concepts" }))
  }

  get_surfaced_policy_hints(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "EpistemicRuntimeImpl.get_surfaced_policy_hints" }))
  }
}

export const EpistemicRuntimeLive = Layer.succeed(EpistemicRuntime, new EpistemicRuntimeImpl())
