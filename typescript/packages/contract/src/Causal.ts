import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError, UnimplementedError } from "./Errors"

export type CausalEngineImpl = {
  discover: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  invalidate_pattern: (id: string) => import("effect").Effect.Effect<void, UnimplementedError>
  retract_pattern: (id: string) => import("effect").Effect.Effect<void, UnimplementedError>
}

export class CausalEngine extends Tag("aura.contract.CausalEngine")<CausalEngine, CausalEngineImpl>() {}

export type CausalStoreImpl = {
  load: () =>
    import("effect").Effect.Effect<
      unknown,
      FileReadError | JsonParseError,
      import("./FileRead").FileRead
    >
  save: (engine: unknown) =>
    import("effect").Effect.Effect<void, FileWriteError, import("./FileWrite").FileWrite>
}

export class CausalStore extends Tag("aura.contract.CausalStore")<CausalStore, CausalStoreImpl>() {}
