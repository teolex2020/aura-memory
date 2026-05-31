import { Effect, Layer } from "effect"
import { BoundedReranker, RerankError } from "@aura/contract"
import type { RecallScored } from "@aura/contract"

/**
 * Bounded Reranker — disabled/no-op adapter until Rust Limited mode can be wired.
 *
 * 有界重排序器：在 Rust Limited 模式可接入前保持 disabled/no-op。
 *
 * Tri-state mode: Off (default), Shadow (observe-only), Limited (bounded rerank).
 * Applied AFTER trust-aware recency scoring. Capped so baseline dominates.
 * Rust reference: BeliefRerankMode::Off / AuraRuntimeState::new / RecallService::apply_bounded_reranking
 * (`../src/recall.rs`, `../src/aura_state.rs`, `../src/recall_service.rs`).
 *
 * NON-PARITY IMPLEMENTATION: Rust `AuraRuntimeState::new()` currently initializes
 * belief/causal/policy reranking to `Limited`. TS removes the old arbitrary
 * position boost and keeps this adapter no-op until the contract can pass
 * `top_k`, records, and belief/concept/causal/policy context needed to implement
 * Rust's bounded guardrails.
 */
export class BoundedRerankerImpl {
  rerank(
    scored: RecallScored,
    _query: string
  ): Effect.Effect<RecallScored, RerankError> {
    return Effect.succeed(scored)
  }
}

export const BoundedRerankerLive = Layer.succeed(BoundedReranker, new BoundedRerankerImpl())
