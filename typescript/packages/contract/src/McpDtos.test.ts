import { describe, it } from "vitest"
import { assert } from "@effect/vitest"
import {
  CrossNamespaceDimensionFlag,
  applyCrossNamespaceDimensionFlags,
  defaultCrossNamespaceDigestOptions,
  normalizeCrossNamespaceDimensionFlag,
  type ExplainabilityBundle,
  type McpMaintenanceTrendSnapshot,
  type McpReflectionSummary,
  UnsupportedSurfaceError
} from "./index"

describe("MCP DTO contract", () => {
  it("keeps Rust-shaped maintenance and reflection keys stable", () => {
    const trend: McpMaintenanceTrendSnapshot = {
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
    assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(trend))), [
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

    const reflection: McpReflectionSummary = {
      timestamp: "2026-05-30T00:00:00Z",
      digest: "stable",
      dominant_phase: "policy",
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
          score: 0.8,
          severity: "high"
        }
      ]
    }
    assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(reflection.report))), [
      "jobs_run",
      "blocker_findings",
      "contradiction_findings",
      "trend_findings",
      "total_findings",
      "capped"
    ])
  })

  it("matches Rust cross-namespace dimension flag handling", () => {
    assert.strictEqual(normalizeCrossNamespaceDimensionFlag("beliefs"), CrossNamespaceDimensionFlag.BeliefStates)
    assert.strictEqual(normalizeCrossNamespaceDimensionFlag("correction_density"), CrossNamespaceDimensionFlag.Corrections)
    assert.strictEqual(normalizeCrossNamespaceDimensionFlag("unknown"), null)

    const options = applyCrossNamespaceDimensionFlags(defaultCrossNamespaceDigestOptions(), [
      "concepts",
      "belief_state",
      "unknown"
    ])

    assert.strictEqual(options.include_concepts, true)
    assert.strictEqual(options.include_belief_states, true)
    assert.strictEqual(options.include_tags, false)
    assert.strictEqual(options.include_structural, false)
    assert.strictEqual(options.include_causal, false)
    assert.strictEqual(options.include_corrections, false)
  })

  it("provides reusable typed unsupported errors", () => {
    const err = new UnsupportedSurfaceError({
      surface: "explainability_bundle",
      reason: "missing provenance read model",
      rustReference: "../src/aura.rs::explainability_bundle",
      missingPrerequisites: ["ProvenanceChain"]
    })
    assert.strictEqual(err._tag, "UnsupportedSurfaceError")
    assert.strictEqual(err.surface, "explainability_bundle")
  })

  it("allows the full explainability bundle member shape", () => {
    const bundle: ExplainabilityBundle = {
      record_id: "r1",
      explanation: {
        rank: 1,
        record_id: "r1",
        score: 0.9,
        namespace: "default",
        salience: 0.5,
        salience_reason: null,
        salience_explanation: null,
        content_preview: "preview",
        because_record_id: null,
        because_preview: null,
        belief: null,
        has_unresolved_evidence: false,
        honesty_note: null,
        contradiction_dependency: false,
        reflection_references: [],
        answer_support: {
          significance_phrase: null,
          uncertainty_phrase: null,
          contradiction_phrase: null,
          reflection_phrase: null,
          recommended_framing: "direct"
        },
        concepts: [],
        causal_patterns: [],
        policy_hints: [],
        trace: {
          sdr: null,
          ngram: null,
          tags: null,
          embedding: null,
          rrf_score: 0,
          graph_score: 0,
          causal_score: 0,
          pre_trust_score: 0,
          trust_multiplier: 1,
          pre_rerank_score: 0,
          rerank_delta: 0,
          final_score: 0.9
        }
      },
      provenance: {
        record_id: "r1",
        namespace: "default",
        content_preview: "preview",
        build_latency_ms: 0,
        because_record_id: null,
        because_preview: null,
        belief: null,
        concepts: [],
        causal_patterns: [],
        policy_hints: [],
        steps: [],
        narrative: ""
      },
      record_corrections: [],
      belief_corrections: [],
      causal_corrections: [],
      policy_corrections: [],
      belief_instability: {
        total_beliefs: 0,
        resolved: 0,
        unresolved: 0,
        singleton: 0,
        empty: 0,
        contradiction_cluster_count: 0,
        high_volatility_count: 0,
        low_stability_count: 0,
        avg_volatility: 0,
        avg_stability: 0,
        volatility_bands: { low: 0, medium: 0, high: 0 }
      },
      reflection_digest: {
        summary_count: 0,
        total_findings: 0,
        high_severity_findings: 0,
        latest_timestamp: "",
        latest_dominant_phase: "",
        kinds: [],
        namespaces: [],
        top_findings: []
      },
      related_reflection_findings: [],
      maintenance_trends: {
        snapshot_count: 0,
        recent: [],
        avg_belief_churn: 0,
        avg_causal_rejection_rate: 0,
        avg_policy_suppression_rate: 0,
        avg_cycle_time_ms: 0,
        avg_correction_events: 0,
        total_corrections_in_window: 0,
        latest_dominant_phase: ""
      }
    }

    assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(bundle))).sort(), [
      "belief_corrections",
      "belief_instability",
      "causal_corrections",
      "explanation",
      "maintenance_trends",
      "policy_corrections",
      "provenance",
      "record_corrections",
      "record_id",
      "reflection_digest",
      "related_reflection_findings"
    ].sort())
  })
})
