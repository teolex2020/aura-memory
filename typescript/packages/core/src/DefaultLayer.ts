import { Layer } from "effect"
import { RecallViewLive } from "@aura/storage"
import { BeliefEngineLive, BeliefStoreLive } from "@aura/belief"
import { ConceptEngineLive, ConceptStoreLive } from "@aura/concept"
import { CausalEngineLive, CausalStoreLive } from "@aura/causal"
import { PolicyEngineLive, PolicyStoreLive } from "@aura/policy"
import { EpistemicRuntimeLive } from "@aura/epistemic-runtime"

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
    EpistemicRuntimeLive
  )
}

