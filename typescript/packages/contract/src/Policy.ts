import { Tag } from "./Context"

export type PolicyEngineImpl = {
  discover: (...args: any[]) => import("effect").Effect.Effect<any>
  retract_hint: (id: string) => import("effect").Effect.Effect<void>
}

export class PolicyEngine extends Tag("aura.contract.PolicyEngine")<PolicyEngine, PolicyEngineImpl>() {}

export type PolicyStoreImpl = {
  load: () => import("effect").Effect.Effect<any>
  save: (engine: any) => import("effect").Effect.Effect<void>
}

export class PolicyStore extends Tag("aura.contract.PolicyStore")<PolicyStore, PolicyStoreImpl>() {}
