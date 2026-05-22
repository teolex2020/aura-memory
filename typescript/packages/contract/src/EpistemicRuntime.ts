import { Tag } from "./Context"

export type EpistemicRuntimeImpl = {
  get_beliefs: () => import("effect").Effect.Effect<any>
  get_concepts: () => import("effect").Effect.Effect<any>
  get_causal_patterns: () => import("effect").Effect.Effect<any>
  get_policy_hints: () => import("effect").Effect.Effect<any>
  get_surfaced_concepts: (...args: any[]) => import("effect").Effect.Effect<any>
  get_surfaced_policy_hints: (...args: any[]) => import("effect").Effect.Effect<any>
}

export class EpistemicRuntime extends Tag("aura.contract.EpistemicRuntime")<
  EpistemicRuntime,
  EpistemicRuntimeImpl
>() {}
