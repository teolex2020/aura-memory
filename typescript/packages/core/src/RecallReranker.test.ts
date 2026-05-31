import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { BeliefState, type BeliefEngineState, type BoundedRerankReport } from "@aura/contract"
import { NodeFileReadLive } from "@aura/platform-node"
import { rerankRecallRecords } from "./RecallReranker"

it("file-backed reranker loads persisted belief state and applies Rust Limited guardrails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recall-reranker-"))
  fs.writeFileSync(
    path.join(dir, "beliefs.cog"),
    JSON.stringify(beliefState({ r3: BeliefState.Resolved }))
  )

  const scored: Array<readonly [number, string]> = [
    [0.800, "r0"],
    [0.799, "r1"],
    [0.798, "r2"],
    [0.797, "r3"]
  ]

  let report: BoundedRerankReport | undefined
  const result = await Effect.runPromise(
    rerankRecallRecords(dir, scored, {
      topK: 10,
      reportSink: (next) => {
        report = next
      }
    }).pipe(Effect.provide(NodeFileReadLive))
  )

  assert.deepStrictEqual(result.map(([, id]) => id), ["r0", "r3", "r1", "r2"])
  assert.strictEqual(report?.belief?.was_applied, true)
  assert.strictEqual(report?.belief?.belief_coverage, 0.25)
  assert.ok((report?.belief?.avg_belief_multiplier ?? 0) > 1)
})

function beliefState(records: Record<string, BeliefState>): BeliefEngineState {
  const beliefs: Record<string, BeliefEngineState["beliefs"][string]> = {}
  const record_to_belief: Record<string, string> = {}
  for (const [recordId, state] of Object.entries(records)) {
    const beliefId = `b-${recordId}`
    record_to_belief[recordId] = beliefId
    beliefs[beliefId] = {
      id: beliefId,
      key: beliefId,
      hypothesis_ids: [],
      winner_id: null,
      state,
      score: 1,
      confidence: 1,
      support_mass: 1,
      conflict_mass: 0,
      stability: 1,
      volatility: 0,
      last_updated: 0
    }
  }
  return { version: 1, beliefs, hypotheses: {}, record_to_belief, key_index: {}, record_index: record_to_belief }
}
