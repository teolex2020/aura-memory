import { Tag } from "./Context"
import { FileReadError, FileWriteError, JsonParseError, UnimplementedError } from "./Errors"

import type { FileRead } from "./FileRead"
import type { FileWrite } from "./FileWrite"
import type { Effect } from "effect"

export type CausalEngineImpl = {
  discover: (...args: unknown[]) => Effect.Effect<unknown, UnimplementedError>
  invalidate_pattern: (id: string) => Effect.Effect<void, UnimplementedError>
  retract_pattern: (id: string) => Effect.Effect<void, UnimplementedError>
}

export class CausalEngine extends Tag("aura.contract.CausalEngine")<CausalEngine, CausalEngineImpl>() {}

export type CausalStoreImpl = {
  load: () =>
    Effect.Effect<
      unknown,
      FileReadError | JsonParseError,
      FileRead
    >
  save: (engine: unknown) =>
    Effect.Effect<void, FileWriteError, FileWrite>
}

export class CausalStore extends Tag("aura.contract.CausalStore")<CausalStore, CausalStoreImpl>() {}
