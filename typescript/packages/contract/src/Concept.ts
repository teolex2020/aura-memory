import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError, UnimplementedError } from "./Errors"

export type ConceptEngineImpl = {
  with_seed_mode: (mode: unknown) => import("effect").Effect.Effect<void, UnimplementedError>
  discover: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  stable_concepts: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  active_candidates: () => import("effect").Effect.Effect<unknown, UnimplementedError>
  stats: () => import("effect").Effect.Effect<unknown, UnimplementedError>
}

export class ConceptEngine extends Tag("aura.contract.ConceptEngine")<ConceptEngine, ConceptEngineImpl>() {}

export type ConceptStoreImpl = {
  load: () =>
    import("effect").Effect.Effect<
      unknown,
      FileReadError | JsonParseError,
      import("./FileRead").FileRead
    >
  save: (engine: unknown) =>
    import("effect").Effect.Effect<void, FileWriteError, import("./FileWrite").FileWrite>
}

export class ConceptStore extends Tag("aura.contract.ConceptStore")<ConceptStore, ConceptStoreImpl>() {}
