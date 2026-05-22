import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError, UnimplementedError } from "./Errors"

export type PolicyEngineImpl = {
  discover: (...args: unknown[]) => import("effect").Effect.Effect<unknown, UnimplementedError>
  retract_hint: (id: string) => import("effect").Effect.Effect<void, UnimplementedError>
}

export class PolicyEngine extends Tag("aura.contract.PolicyEngine")<PolicyEngine, PolicyEngineImpl>() {}

export type PolicyStoreImpl = {
  load: () =>
    import("effect").Effect.Effect<
      unknown,
      FileReadError | JsonParseError,
      import("./FileRead").FileRead
    >
  save: (engine: unknown) =>
    import("effect").Effect.Effect<void, FileWriteError, import("./FileWrite").FileWrite>
}

export class PolicyStore extends Tag("aura.contract.PolicyStore")<PolicyStore, PolicyStoreImpl>() {}
