import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { Aura } from "@aura/core"
import { Level, UnsupportedSurfaceError } from "@aura/contract"
import { createAuraTools } from "./tools"
import { TOOL_NAMES, type ToolName } from "./inventory"
import type { AuraMcpRuntime } from "./runtime"

type ToolContext = Readonly<Record<string, unknown>>

type ExecutableTool = {
  readonly execute: (args: { readonly context: ToolContext }) => Promise<unknown>
}

const record = {
  id: "rec-1",
  content: "stored memory",
  level: Level.Working,
  tags: ["alpha", "beta"],
  strength: 1,
  source_type: "recorded",
  semantic_type: "fact",
}

const contexts: Record<ToolName, ToolContext> = {
  recall: { query: "memory" },
  recall_structured: { query: "memory", top_k: 1 },
  store: { content: "stored memory", tags: ["alpha"] },
  store_code: { code: "console.log('x')", language: "typescript" },
  store_decision: { decision: "Use MCP", reasoning: "External clients need tools" },
  search: { query: "stored", tags: ["alpha", "beta"] },
  insights: {},
  maintain: {},
  cross_namespace_digest: {},
  explain_record: { record_id: "rec-1" },
  explain_recall: { query: "memory" },
  explainability_bundle: { record_id: "rec-1" },
  correction_log: {},
  correction_review_queue: {},
  contradiction_review_queue: {},
  suggested_corrections: {},
  namespace_governance_status: {},
  policy_lifecycle: {},
  belief_instability: {},
  memory_health: {},
  consolidate: {},
}

const aura = Object.assign(Object.create(Aura.prototype), {
  recall_structured: () => Effect.succeed([[0.9, record]] as const),
  store: () => Effect.succeed(record),
  store_code: () => Effect.succeed({ ...record, level: Level.Domain }),
  store_decision: () => Effect.succeed({ ...record, level: Level.Decisions }),
  search: () => [record],
  insights: () => ({ total_records: 1 }),
  maintain: () => Effect.succeed({ totalRecords: 1, insightsFound: 0 }),
  cross_namespace_digest_with_options: () => Effect.succeed({ namespace_count: 1, namespaces: [], pairs: [] }),
  explain_record: () => Effect.succeed({ record_id: "rec-1", rank: 1, score: 1 }),
  explain_recall: () => Effect.succeed({ query: "memory", result_count: 1, items: [] }),
  explainability_bundle: () => Effect.succeed({ record_id: "rec-1", record_corrections: [] }),
  get_correction_log: () => [{ timestamp: 2, target_kind: "record", target_id: "rec-1" }],
  get_correction_log_for_target: () => [{ timestamp: 2, target_kind: "record", target_id: "rec-1" }],
  correction_review_queue: () => Effect.succeed([]),
  contradiction_review_queue: () => Effect.succeed([]),
  suggested_corrections: () => Effect.succeed([]),
  get_namespace_governance_status_filtered: () => Effect.succeed([]),
  policy_lifecycle_report: () => Effect.succeed({ summary: {}, pressure: [], suppressed: [], rejected: [] }),
  belief_instability_report: () => Effect.succeed({
    summary: {},
    high_volatility: [],
    low_stability: [],
    recently_corrected: [],
  }),
  memory_health: () => Effect.succeed({ total_records: 1, top_issues: [] }),
  consolidate: () => Effect.fail(new UnsupportedSurfaceError({
    surface: "Aura.consolidate",
    reason: "TS core has no Rust-parity consolidation merge/update path yet; dummy success counts are forbidden.",
    rustReference: "Aura::consolidate (aura.rs)",
    missingPrerequisites: ["Rust-parity consolidation algorithm"],
  })),
}) as Aura

const runtime: AuraMcpRuntime = {
  brainPath: "memory://invocation",
  aura,
  runEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect as Effect.Effect<A, E, never>),
}

function executable(tool: unknown): ExecutableTool {
  return tool as ExecutableTool
}

describe("Aura MCP invocation coverage", () => {
  it("invokes every advertised tool and returns text payloads", async () => {
    const tools = createAuraTools(runtime)

    for (const name of TOOL_NAMES) {
      const output = await executable(tools[name]).execute({ context: contexts[name] })
      expect(output, name).toEqual(expect.any(String))
    }
  })

  it("maps unsupported core surfaces to the standardized MCP text error payload", async () => {
    const tools = createAuraTools(runtime)
    const output = await executable(tools.consolidate).execute({ context: {} })
    const parsed = JSON.parse(String(output))

    expect(parsed).toMatchObject({
      ok: false,
      error: {
        code: "unsupported_surface",
        surface: "Aura.consolidate",
        rust_reference: "Aura::consolidate (aura.rs)",
      },
    })
  })

  it("keeps Rust-shaped JSON text payloads for representative tools", async () => {
    const tools = createAuraTools(runtime)

    expect(JSON.parse(String(await executable(tools.store_code).execute({ context: contexts.store_code })))).toEqual({
      id: "rec-1",
      level: "DOMAIN",
    })
    expect(JSON.parse(String(await executable(tools.recall_structured).execute({ context: contexts.recall_structured })))).toEqual([
      {
        id: "rec-1",
        content: "stored memory",
        score: 0.9,
        level: "Working",
        tags: ["alpha", "beta"],
        strength: 1,
        source_type: "recorded",
        semantic_type: "fact",
      },
    ])
  })
})
