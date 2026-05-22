import { Effect, Layer } from "effect"
import { BeliefEngine, UnimplementedError } from "@aura/contract"

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
  with_coarse_key_mode(_mode: unknown): Effect.Effect<void, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.with_coarse_key_mode" }))
  }

  claim_key(
    _namespace: string,
    _tags: ReadonlyArray<string>,
    _semantic_type: string
  ): Effect.Effect<string, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.claim_key" }))
  }

  claim_key_with_mode(
    _namespace: string,
    _tags: ReadonlyArray<string>,
    _semantic_type: string,
    _mode: unknown
  ): Effect.Effect<string, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.claim_key_with_mode" }))
  }

  update(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.update" }))
  }

  update_with_sdr(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.update_with_sdr" }))
  }

  belief_for_record(_record_id: string): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.belief_for_record" }))
  }

  deprecate_belief(_belief_id: string): Effect.Effect<void, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.deprecate_belief" }))
  }

  apply_layer_feedback(..._args: unknown[]): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.apply_layer_feedback" }))
  }

  unresolved_beliefs(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.unresolved_beliefs" }))
  }

  stats(): Effect.Effect<unknown, UnimplementedError> {
    return Effect.fail(new UnimplementedError({ feature: "BeliefEngineImpl.stats" }))
  }
}

export const BeliefEngineLive = Layer.succeed(BeliefEngine, new BeliefEngineImpl())
