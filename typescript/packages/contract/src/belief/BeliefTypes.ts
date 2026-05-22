export type BeliefId = string
export type HypothesisId = string

export type BeliefState = "Resolved" | "Unresolved" | "Singleton" | "Empty"

export type Belief = {
  readonly id: BeliefId
  readonly key: string
  readonly hypothesis_ids: ReadonlyArray<HypothesisId>
  readonly winner_id: string | null
  readonly state: BeliefState
  readonly score: number
  readonly confidence: number
  readonly support_mass: number
  readonly conflict_mass: number
  readonly stability: number
  readonly volatility: number
  readonly last_updated: number
}

export type Hypothesis = {
  readonly id: HypothesisId
  readonly belief_id: BeliefId
  readonly prototype_record_ids: ReadonlyArray<string>
  readonly confidence: number
  readonly support_mass: number
  readonly conflict_mass: number
  readonly recency: number
  readonly consistency: number
  readonly score: number
}

export type BeliefEngineState = {
  readonly version: 1
  readonly beliefs: Readonly<Record<string, Belief>>
  readonly hypotheses: Readonly<Record<string, Hypothesis>>
  readonly record_to_belief: Readonly<Record<string, string>>
}

export type BeliefReport = {
  readonly coarse_groups: number
  readonly beliefs_built: number
  readonly hypotheses_built: number
}
