import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError, UnimplementedError } from "./Errors"

import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export type PolicyEngineImpl = {
  discover: (...args: unknown[]) => Effect.Effect<unknown, UnimplementedError>
  retract_hint: (id: string) => Effect.Effect<void, UnimplementedError>
}

export class PolicyEngine extends Tag("aura.contract.PolicyEngine")<PolicyEngine, PolicyEngineImpl>() {}

export type PolicyStoreImpl = {
  load: () =>
    Effect.Effect<
      unknown,
      FileReadError | JsonParseError,
      FileRead
    >
  save: (engine: unknown) =>
    Effect.Effect<void, FileWriteError, FileWrite>
}

export class PolicyStore extends Tag("aura.contract.PolicyStore")<PolicyStore, PolicyStoreImpl>() {}
