import { createTool } from "@mastra/core/tools"
import { Level } from "@aura/contract"
import type { AuraSearchOptions } from "@aura/core"
import type { AuraMcpRuntime } from "./runtime"
import { toMcpErrorText, toText } from "./runtime"
import {
  beliefInstabilitySchema,
  correctionLogSchema,
  correctionReviewQueueSchema,
  contradictionReviewQueueSchema,
  crossNamespaceDigestSchema,
  emptySchema,
  explainRecallSchema,
  explainRecordSchema,
  memoryHealthSchema,
  namespaceGovernanceSchema,
  policyLifecycleSchema,
  recallSchema,
  recallStructuredSchema,
  searchSchema,
  storeCodeSchema,
  storeDecisionSchema,
  storeSchema,
  suggestedCorrectionsSchema,
} from "./inventory"

function namespaces(namespace: string | undefined): ReadonlyArray<string> | undefined {
  return namespace === undefined ? undefined : [namespace]
}

function levelFromInput(level: "working" | "decisions" | "domain" | "identity" | undefined): Level | undefined {
  switch (level) {
    case "working":
      return Level.Working
    case "decisions":
      return Level.Decisions
    case "domain":
      return Level.Domain
    case "identity":
      return Level.Identity
    case undefined:
      return undefined
  }
}

type RecallContextRecord = {
  readonly content: string
  readonly level?: Level | string
  readonly tags?: ReadonlyArray<string>
  readonly content_type?: string
  readonly source_type?: string
  readonly semantic_type?: string
  readonly metadata?: Readonly<Record<string, string>>
}

async function runText<A, E, R>(runtime: AuraMcpRuntime, effect: import("effect").Effect.Effect<A, E, R>) {
  try {
    return toText(await runtime.runEffect(effect))
  } catch (error) {
    return toMcpErrorText(error)
  }
}

async function runMappedText<A, B, E, R>(
  runtime: AuraMcpRuntime,
  effect: import("effect").Effect.Effect<A, E, R>,
  map: (value: A) => B,
) {
  try {
    return toText(map(await runtime.runEffect(effect)))
  } catch (error) {
    return toMcpErrorText(error)
  }
}

function formatRecallContext(
  results: ReadonlyArray<readonly [score: number, record: RecallContextRecord]>,
  tokenBudget: number,
): string {
  if (results.length === 0) return ""

  const byLevel = new Map<Level, Array<RecallContextRecord>>()
  for (const [, record] of results) {
    const level = normalizeLevel(record.level)
    const records = byLevel.get(level) ?? []
    records.push(record)
    byLevel.set(level, records)
  }

  let output = "=== COGNITIVE CONTEXT ===\n"
  const identityBudget = Math.max(128, Math.trunc(tokenBudget * 0.25))
  const remainingBudget = Math.max(0, tokenBudget - identityBudget)
  const levelOrder = [Level.Identity, Level.Domain, Level.Decisions, Level.Working]

  for (const level of levelOrder) {
    const records = byLevel.get(level)
    if (records === undefined) continue

    output += `[${Level.displayName(level)}]\n`
    const budget = level === Level.Identity ? identityBudget : Math.trunc(remainingBudget / 3)
    let levelTokens = 0

    for (const record of records) {
      const formatted = formatRecallRecord(record)
      const tokens = estimateTokens(formatted)
      if (levelTokens + tokens > budget) break
      output += formatted + "\n"
      levelTokens += tokens
    }
    output += "\n"
  }

  output += "=== END CONTEXT ==="
  return output
}

function normalizeLevel(level: Level | string | undefined): Level {
  switch (String(level ?? Level.Working).toLowerCase()) {
    case "identity":
      return Level.Identity
    case "domain":
      return Level.Domain
    case "decisions":
      return Level.Decisions
    default:
      return Level.Working
  }
}

function formatRecallRecord(record: RecallContextRecord): string {
  const tags = record.tags !== undefined && record.tags.length > 0 ? ` [${record.tags.join(", ")}]` : ""
  const source = sourceLabel(record.source_type)
  const semantic = semanticLabel(record.semantic_type)
  if (record.content_type === "code") {
    const language = record.metadata?.language ?? ""
    return `  - [CODE]${source}${semantic}${tags}\n\`\`\`${language}\n${record.content}\n\`\`\``
  }
  if (record.content_type === "json") {
    return `  - [JSON]${source}${semantic}${tags}\n\`\`\`json\n${record.content}\n\`\`\``
  }
  return `  - ${record.content}${source}${semantic}${tags}`
}

function sourceLabel(sourceType: string | undefined): string {
  switch (sourceType) {
    case "retrieved":
      return " [retrieved]"
    case "inferred":
      return " [inferred]"
    case "generated":
      return " [generated]"
    default:
      return ""
  }
}

function semanticLabel(semanticType: string | undefined): string {
  switch (semanticType) {
    case "decision":
      return " {decision}"
    case "preference":
      return " {preference}"
    case "trend":
      return " {trend}"
    case "serendipity":
      return " {serendipity}"
    case "contradiction":
      return " {contradiction}"
    default:
      return ""
  }
}

function estimateTokens(text: string): number {
  return Math.trunc(text.split(/\s+/).filter((word) => word.length > 0).length * 1.3)
}

export function createAuraTools(runtime: AuraMcpRuntime) {
  return {
    recall: createTool({
      id: "recall",
      description: "Retrieve relevant memories as context for a query. Use before answering when existing Aura memory may affect the response.",
      inputSchema: recallSchema,
      execute: async ({ context }) =>
        runMappedText(
          runtime,
          runtime.aura.recall_structured(context.query, {
            topK: 20,
            minStrength: 0.1,
            expandConnections: true,
            namespaces: namespaces(context.namespace),
          }),
          (results) => formatRecallContext(results, context.token_budget ?? 2048),
        ),
    }),

    recall_structured: createTool({
      id: "recall_structured",
      description: "Retrieve memories as structured scored records. Use when individual record IDs, scores, levels, or metadata are needed.",
      inputSchema: recallStructuredSchema,
      execute: async ({ context }) =>
        runMappedText(
          runtime,
          runtime.aura.recall_structured(context.query, {
            topK: context.top_k,
            namespaces: namespaces(context.namespace),
          }),
          (results) => results.map(([score, record]) => ({
            id: record.id,
            content: record.content,
            score,
            level: record.level,
            tags: record.tags,
            strength: record.strength,
            source_type: record.source_type,
            semantic_type: record.semantic_type,
          })),
        ),
    }),

    store: createTool({
      id: "store",
      description: "Store a new memory in Aura. Use for durable facts, decisions, observations, or generated information that should be remembered.",
      inputSchema: storeSchema,
      execute: async ({ context }) =>
        runMappedText(
          runtime,
          runtime.aura.store(context.content, {
            level: levelFromInput(context.level),
            tags: context.tags,
            content_type: context.content_type,
            source_type: context.source_type,
            caused_by_id: context.caused_by_id,
            namespace: context.namespace,
            semantic_type: context.semantic_type,
          }),
          (record) => ({ id: record.id, level: record.level }),
        ),
    }),

    store_code: createTool({
      id: "store_code",
      description: "Store a code snippet at domain level with language and optional filename metadata.",
      inputSchema: storeCodeSchema,
      execute: async ({ context }) =>
        runMappedText(
          runtime,
          runtime.aura.store_code(context),
          (record) => ({ id: record.id, level: "DOMAIN" }),
        ),
    }),

    store_decision: createTool({
      id: "store_decision",
      description: "Store a decision with reasoning and alternatives at decisions level.",
      inputSchema: storeDecisionSchema,
      execute: async ({ context }) =>
        runMappedText(
          runtime,
          runtime.aura.store_decision(context),
          (record) => ({ id: record.id, level: "DECISIONS" }),
        ),
    }),

    search: createTool({
      id: "search",
      description: "Search memory by exact filters. Use for browsing or counting, not semantic ranking.",
      inputSchema: searchSchema,
      execute: async ({ context }) => {
        const options: AuraSearchOptions = {
          query: context.query,
          level: levelFromInput(context.level),
          tags: context.tags,
          limit: context.limit,
          content_type: context.content_type,
          source_type: context.source_type,
          namespace: context.namespace,
          semantic_type: context.semantic_type,
        }
        return toText(runtime.aura.search(options).map((record) => ({
          id: record.id,
          content: record.content,
          level: record.level,
          tags: record.tags,
          semantic_type: record.semantic_type,
        })))
      },
    }),

    insights: createTool({
      id: "insights",
      description: "Get proactive insights about memory health. In TS this mirrors the Rust MCP stats-backed insights path.",
      inputSchema: emptySchema,
      execute: async () => toText(runtime.aura.insights()),
    }),

    maintain: createTool({
      id: "maintain",
      description: "Run Aura maintenance once against the bound brain and return the maintenance report.",
      inputSchema: emptySchema,
      execute: async () => runText(runtime, runtime.aura.maintain()),
    }),

    cross_namespace_digest: createTool({
      id: "cross_namespace_digest",
      description: "Return a read-only digest across namespaces: concepts, tags, structural overlap, causal signatures, belief states, and corrections.",
      inputSchema: crossNamespaceDigestSchema,
      execute: async ({ context }) =>
        runText(runtime, runtime.aura.cross_namespace_digest_with_options(context.namespaces, {
          min_record_count: context.min_record_count,
          top_concepts_limit: context.top_concepts_limit,
          pairwise_similarity_threshold: context.pairwise_similarity_threshold,
          include_dimensions: context.include_dimensions,
          compact_summary: context.compact_summary,
        })),
    }),

    explain_record: createTool({
      id: "explain_record",
      description: "Explain one record through belief, concept, causal, and policy provenance.",
      inputSchema: explainRecordSchema,
      execute: async ({ context }) => runText(runtime, runtime.aura.explain_record(context.record_id)),
    }),

    explain_recall: createTool({
      id: "explain_recall",
      description: "Explain recall scoring and provenance for a query.",
      inputSchema: explainRecallSchema,
      execute: async ({ context }) =>
        runText(runtime, runtime.aura.explain_recall(
          context.query,
          context.top_k,
          context.min_strength,
          context.expand_connections,
          namespaces(context.namespace),
        )),
    }),

    explainability_bundle: createTool({
      id: "explainability_bundle",
      description: "Return one bounded explainability bundle for a record, including provenance, correction excerpts, instability, and maintenance trends.",
      inputSchema: explainRecordSchema,
      execute: async ({ context }) => runText(runtime, runtime.aura.explainability_bundle(context.record_id)),
    }),

    correction_log: createTool({
      id: "correction_log",
      description: "Read correction-log entries globally or for a specific target.",
      inputSchema: correctionLogSchema,
      execute: async ({ context }) => {
        const entries = context.target_kind !== undefined && context.target_id !== undefined
          ? runtime.aura.get_correction_log_for_target(context.target_kind, context.target_id)
          : runtime.aura.get_correction_log()
        return toText(entries
          .slice()
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, context.limit ?? 50))
      },
    }),

    correction_review_queue: createTool({
      id: "correction_review_queue",
      description: "Return prioritized correction review candidates using recency, repeated corrections, and downstream impact.",
      inputSchema: correctionReviewQueueSchema,
      execute: async ({ context }) => runText(runtime, runtime.aura.correction_review_queue(context.limit)),
    }),

    contradiction_review_queue: createTool({
      id: "contradiction_review_queue",
      description: "Return prioritized contradiction review candidates using unstable belief clusters and downstream impact.",
      inputSchema: contradictionReviewQueueSchema,
      execute: async ({ context }) =>
        runText(runtime, runtime.aura.contradiction_review_queue(context.namespace, context.limit)),
    }),

    suggested_corrections: createTool({
      id: "suggested_corrections",
      description: "Return advisory suggested corrections without auto-application.",
      inputSchema: suggestedCorrectionsSchema,
      execute: async ({ context }) => runText(runtime, runtime.aura.suggested_corrections(context.limit)),
    }),

    namespace_governance_status: createTool({
      id: "namespace_governance_status",
      description: "Return read-only per-namespace governance summaries.",
      inputSchema: namespaceGovernanceSchema,
      execute: async ({ context }) =>
        runText(runtime, runtime.aura.get_namespace_governance_status_filtered(context.namespaces)),
    }),

    policy_lifecycle: createTool({
      id: "policy_lifecycle",
      description: "Return bounded policy lifecycle summaries and advisory-pressure areas for operator inspection.",
      inputSchema: policyLifecycleSchema,
      execute: async ({ context }) =>
        runText(runtime, runtime.aura.policy_lifecycle_report(
          context.namespace,
          context.limit,
          context.action_limit,
          context.domain_limit,
        )),
    }),

    belief_instability: createTool({
      id: "belief_instability",
      description: "Return bounded belief-instability inspection output.",
      inputSchema: beliefInstabilitySchema,
      execute: async ({ context }) =>
        runText(runtime, runtime.aura.belief_instability_report(
          context.min_volatility,
          context.max_stability,
          context.limit,
        )),
    }),

    memory_health: createTool({
      id: "memory_health",
      description: "Return one compact operator-facing memory health digest.",
      inputSchema: memoryHealthSchema,
      execute: async ({ context }) => runText(runtime, runtime.aura.memory_health(context.limit)),
    }),

    consolidate: createTool({
      id: "consolidate",
      description: "Merge similar memory records through the Rust-parity consolidation path.",
      inputSchema: emptySchema,
      execute: async () => runText(runtime, runtime.aura.consolidate()),
    }),
  }
}
