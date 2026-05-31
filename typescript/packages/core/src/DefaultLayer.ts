import { Layer } from "effect"
import { RecallViewLive } from "@aura/storage"
import { BeliefEngineLive, BeliefStoreLive } from "@aura/belief"
import { ConceptEngineLive, ConceptStoreLive } from "@aura/concept"
import { CausalEngineLive, CausalStoreLive } from "@aura/causal"
import { PolicyEngineLive, PolicyStoreLive } from "@aura/policy"
import { EpistemicRuntimeLive, EpistemicTraceLive } from "@aura/epistemic-runtime"
import { RecallFinalizerFileLive } from "./RecallFinalizer"

export function DefaultLayer(brainDir: string) {
  return Layer.mergeAll(
    RecallViewLive(brainDir),
    BeliefStoreLive(brainDir),
    BeliefEngineLive,
    ConceptStoreLive(brainDir),
    ConceptEngineLive,
    CausalStoreLive(brainDir),
    CausalEngineLive,
    PolicyStoreLive(brainDir),
    PolicyEngineLive,
    EpistemicRuntimeLive,
    EpistemicTraceLive,
    // NON-PARITY IMPLEMENTATION: Rust AuraRuntimeState defaults bounded reranking to Limited.
    // TS does not inject BoundedRerankerLive here until it can implement the full Rust
    // belief/concept/causal/policy bounded guardrails instead of a misleading score boost.
    // Rust reference: AuraRuntimeState::new / RecallService::apply_bounded_reranking
    // (`../src/aura_state.rs`, `../src/recall_service.rs`).
    RecallFinalizerFileLive(brainDir)
  )
}
