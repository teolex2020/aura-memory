import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import {
  MAINTENANCE_TRENDS_FILE,
  MaintenanceTrendsFile,
  REFLECTION_SUMMARIES_FILE,
  ReflectionSummariesFile
} from "./MaintenanceArtifactFiles"
import { currentPersistenceManifest } from "./PersistenceManifest"

it("MaintenanceTrendsFile load/save roundtrip preserves Rust-shaped JSON", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-maintenance-trends-"))
  const file = MaintenanceTrendsFile.new(dir)

  const empty = await Effect.runPromise(file.load().pipe(Effect.provide(NodeFileReadLive)))
  assert.deepStrictEqual(empty, [])

  const history = [
    {
      timestamp: "2026-05-30T00:00:00Z",
      total_records: 3,
      records_archived: 1,
      insights_found: 2,
      volatile_records: 1,
      belief_churn: 0.25,
      causal_rejection_rate: 0.1,
      policy_suppression_rate: 0.2,
      feedback_beliefs_touched: 4,
      feedback_net_confidence_delta: 0.3,
      feedback_net_volatility_delta: -0.1,
      correction_events: 1,
      cumulative_corrections: 5,
      cycle_time_ms: 12.5,
      dominant_phase: "belief"
    }
  ]
  await Effect.runPromise(file.save(history).pipe(Effect.provide(NodeFileWriteLive)))

  const loaded = await Effect.runPromise(file.load().pipe(Effect.provide(NodeFileReadLive)))
  assert.deepStrictEqual(loaded, history)
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, MAINTENANCE_TRENDS_FILE), "utf8"))[0]), [
    "timestamp",
    "total_records",
    "records_archived",
    "insights_found",
    "volatile_records",
    "belief_churn",
    "causal_rejection_rate",
    "policy_suppression_rate",
    "feedback_beliefs_touched",
    "feedback_net_confidence_delta",
    "feedback_net_volatility_delta",
    "correction_events",
    "cumulative_corrections",
    "cycle_time_ms",
    "dominant_phase"
  ])
})

it("ReflectionSummariesFile load/save roundtrip preserves Rust-shaped JSON", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-reflection-summaries-"))
  const file = ReflectionSummariesFile.new(dir)

  const history = [
    {
      timestamp: "2026-05-30T00:00:00Z",
      digest: "summary",
      dominant_phase: "causal",
      report: {
        jobs_run: 1,
        blocker_findings: 0,
        contradiction_findings: 1,
        trend_findings: 0,
        total_findings: 1,
        capped: false
      },
      findings: [
        {
          kind: "contradiction",
          namespace: "default",
          title: "conflict",
          detail: "detail",
          related_ids: ["r1"],
          score: 0.9,
          severity: "high"
        }
      ]
    }
  ]
  await Effect.runPromise(file.save(history).pipe(Effect.provide(NodeFileWriteLive)))

  const loaded = await Effect.runPromise(file.load().pipe(Effect.provide(NodeFileReadLive)))
  assert.deepStrictEqual(loaded, history)
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, REFLECTION_SUMMARIES_FILE), "utf8"))[0].report), [
    "jobs_run",
    "blocker_findings",
    "contradiction_findings",
    "trend_findings",
    "total_findings",
    "capped"
  ])
})

it("manifest declares maintenance artifact surfaces", () => {
  const manifest = currentPersistenceManifest()
  assert.strictEqual(manifest.surfaces.maintenance_trends, 1)
  assert.strictEqual(manifest.surfaces.reflection_summaries, 1)
})
