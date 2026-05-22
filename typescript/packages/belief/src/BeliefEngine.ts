import { Effect, Layer } from "effect"
import { BeliefEngine } from "@aura/contract"

export type CoarseKeyMode =
  | "Standard"
  | "TopOneTag"
  | "SemanticOnly"
  | "TagFamily"
  | "TagFamilyAdaptive"
  | "TagFamilyBackoff"
  | "TagFamilyPairBackoff"
  | "TagFamilyDenseBackoff"
  | "DualKey"
  | "NeighborhoodPool"
  | "BridgeKey"
  | "SdrTagPool"

export type BeliefState = "Resolved" | "Unresolved" | "Singleton" | "Empty"

export class BeliefEngineImpl {
  with_coarse_key_mode(_mode: CoarseKeyMode): Effect.Effect<void> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.with_coarse_key_mode"))
  }

  claim_key(_namespace: string, _tags: ReadonlyArray<string>, _semantic_type: string): Effect.Effect<string> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.claim_key"))
  }

  claim_key_with_mode(
    _namespace: string,
    _tags: ReadonlyArray<string>,
    _semantic_type: string,
    _mode: CoarseKeyMode
  ): Effect.Effect<string> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.claim_key_with_mode"))
  }

  update(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.update"))
  }

  update_with_sdr(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.update_with_sdr"))
  }

  belief_for_record(_record_id: string): Effect.Effect<any> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.belief_for_record"))
  }

  deprecate_belief(_belief_id: string): Effect.Effect<void> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.deprecate_belief"))
  }

  apply_layer_feedback(..._args: any[]): Effect.Effect<any> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.apply_layer_feedback"))
  }

  unresolved_beliefs(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.unresolved_beliefs"))
  }

  stats(): Effect.Effect<any> {
    return Effect.die(new Error("TODO: BeliefEngineImpl.stats"))
  }
}

export const BeliefEngineLive = Layer.succeed(BeliefEngine, new BeliefEngineImpl())

