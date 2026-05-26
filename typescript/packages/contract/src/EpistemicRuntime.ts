import { Tag } from "./Context"
import { UnimplementedError } from "./Errors"

import type { Effect } from "effect"

export type EpistemicRuntimeImpl = {
  get_beliefs: () => Effect.Effect<unknown, UnimplementedError>
  get_concepts: () => Effect.Effect<unknown, UnimplementedError>
  get_causal_patterns: () => Effect.Effect<unknown, UnimplementedError>
  get_policy_hints: () => Effect.Effect<unknown, UnimplementedError>
  get_surfaced_concepts: (...args: unknown[]) => Effect.Effect<unknown, UnimplementedError>
  get_surfaced_policy_hints: (...args: unknown[]) => Effect.Effect<unknown, UnimplementedError>
}

export class EpistemicRuntime extends Tag("aura.contract.EpistemicRuntime")<
  EpistemicRuntime,
  EpistemicRuntimeImpl
>() {}
