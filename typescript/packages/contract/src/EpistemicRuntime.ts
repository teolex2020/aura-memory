import { Tag } from "./Context"
import { UnimplementedError } from "./Errors"

export type EpistemicRuntimeImpl = {
  get_beliefs: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  get_concepts: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  get_causal_patterns: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  get_policy_hints: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  get_surfaced_concepts: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  get_surfaced_policy_hints: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
}

export class EpistemicRuntime extends Tag("aura.contract.EpistemicRuntime")<
  EpistemicRuntime,
  EpistemicRuntimeImpl
>() {}
