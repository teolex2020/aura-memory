import { Tag } from "./Context"

export type CausalEngineImpl = {
  discover: (...args: any[]) => import("effect").Effect.Effect<any>
  invalidate_pattern: (id: string) => import("effect").Effect.Effect<void>
  retract_pattern: (id: string) => import("effect").Effect.Effect<void>
}

export class CausalEngine extends Tag("aura.contract.CausalEngine")<CausalEngine, CausalEngineImpl>() {}

export type CausalStoreImpl = {
  load: () => import("effect").Effect.Effect<any>
  save: (engine: any) => import("effect").Effect.Effect<void>
}

export class CausalStore extends Tag("aura.contract.CausalStore")<CausalStore, CausalStoreImpl>() {}
