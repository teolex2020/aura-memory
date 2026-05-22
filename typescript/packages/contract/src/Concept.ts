import { Tag } from "./Context"

export type ConceptEngineImpl = {
  with_seed_mode: (mode: unknown) => import("effect").Effect.Effect<void>
  discover: (...args: any[]) => import("effect").Effect.Effect<any>
  stable_concepts: () => import("effect").Effect.Effect<any>
  active_candidates: () => import("effect").Effect.Effect<any>
  stats: () => import("effect").Effect.Effect<any>
}

export class ConceptEngine extends Tag("aura.contract.ConceptEngine")<ConceptEngine, ConceptEngineImpl>() {}

export type ConceptStoreImpl = {
  load: () => import("effect").Effect.Effect<any>
  save: (engine: any) => import("effect").Effect.Effect<void>
}

export class ConceptStore extends Tag("aura.contract.ConceptStore")<ConceptStore, ConceptStoreImpl>() {}
