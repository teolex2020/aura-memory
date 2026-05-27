import { Effect, Layer, Option } from "effect"
import {
  BeliefEngine,
  ConceptEngine,
  CausalEngine,
  PolicyEngine,
  EpistemicRuntime,
  EpistemicTrace,
  serviceOption,
  type EpistemicReport,
  type BeliefEngineState,
  type ConceptEngineState,
  type CausalEngineState,
  type PolicyEngineState
} from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import type { SdrLookup } from "@aura/contract"
import type { EpistemicTrace as EpistemicTraceType } from "@aura/contract"

export class EpistemicRuntimeImpl {
  /**
   * Run the full maintenance pipeline:
   *   Belief → Concept → Causal → Policy
   *
   * 执行完整维护流程：Belief → Concept → Causal → Policy
   */
  maintain(
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ): Effect.Effect<EpistemicReport, never, EpistemicTraceType> {
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined

      if (trace) yield* trace.event("maintenance.start", { records: records.size })

      // Phase 1: Belief — update beliefs with SDR
      const beliefEngine = yield* Effect.service(BeliefEngine)
      const belief = yield* beliefEngine.update_with_sdr(records, sdr_lookup)

      // Phase 2: Concept — discover concepts from beliefs
      const conceptEngine = yield* Effect.service(ConceptEngine)
      const concept = yield* conceptEngine.discover(
        beliefEngine,
        records,
        sdr_lookup
      )

      // Phase 3: Causal — discover patterns from concepts
      const causalEngine = yield* Effect.service(CausalEngine)
      const conceptState = yield* conceptEngine.stats()
      const causal = yield* causalEngine.discover(
        conceptState,
        records,
        sdr_lookup
      )

      // Phase 4: Policy — extract hints from causal patterns
      const policyEngine = yield* Effect.service(PolicyEngine)
      const causalState = yield* causalEngine.stats()
      const policy = yield* policyEngine.discover(
        causalState,
        records
      )

      if (trace) yield* trace.event("maintenance.end", {
        beliefs: belief.beliefs_built,
        concepts: concept.candidates_found,
        causal: causal.patterns_found,
        policy: policy.hints_found
      })

      return { belief, concept, causal, policy }
    })
  }

  get_beliefs(): Effect.Effect<BeliefEngineState> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      return yield* engine.stats()
    })
  }

  get_concepts(): Effect.Effect<ConceptEngineState> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(ConceptEngine)
      return yield* engine.stats()
    })
  }

  get_causal_patterns(): Effect.Effect<CausalEngineState> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(CausalEngine)
      return yield* engine.stats()
    })
  }

  get_policy_hints(): Effect.Effect<PolicyEngineState> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      return yield* engine.stats()
    })
  }

  get_surfaced_concepts(..._args: unknown[]): Effect.Effect<unknown> {
    return Effect.die(new Error("EpistemicRuntimeImpl.get_surfaced_concepts: not implemented"))
  }

  get_surfaced_policy_hints(..._args: unknown[]): Effect.Effect<unknown> {
    return Effect.die(new Error("EpistemicRuntimeImpl.get_surfaced_policy_hints: not implemented"))
  }
}

export const EpistemicRuntimeLive = Layer.succeed(
  EpistemicRuntime,
  new EpistemicRuntimeImpl()
)

export { EpistemicTraceLive } from "./EpistemicTrace"
