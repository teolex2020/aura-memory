import { z } from "zod"

const stringList = () => z.array(z.string()).optional()
const namespace = () => z.string().optional()
const limit = () => z.number().int().positive().optional()
const level = () => z.enum(["working", "decisions", "domain", "identity"]).optional()

export const recallSchema = z.object({
  query: z.string().min(1).describe("Natural language query to search memories."),
  token_budget: z.number().int().positive().optional().describe("Maximum tokens in output; accepted for Rust MCP parity."),
  namespace: namespace().describe("Namespace to search in. Defaults to default."),
})

export const recallStructuredSchema = z.object({
  query: z.string().min(1).describe("Natural language query to search memories."),
  top_k: limit().describe("Maximum number of results. Defaults to 20."),
  namespace: namespace().describe("Namespace to search in. Defaults to default."),
})

export const storeSchema = z.object({
  content: z.string().min(1).describe("The text content to store."),
  level: level().describe("Memory level: working, decisions, domain, or identity."),
  tags: stringList().describe("Tags for categorization."),
  content_type: z.string().optional().describe("Content type hint, such as text, code, or decision."),
  source_type: z.string().optional().describe("Source type: recorded, retrieved, inferred, or generated."),
  caused_by_id: z.string().optional().describe("ID of the record that caused this one."),
  namespace: namespace().describe("Namespace to store in. Defaults to default."),
  semantic_type: z.string().optional().describe("Semantic role such as fact, decision, trend, or contradiction."),
})

export const storeCodeSchema = z.object({
  code: z.string().min(1).describe("The source code to store."),
  language: z.string().min(1).describe("Programming language such as typescript, rust, or python."),
  filename: z.string().optional().describe("Optional filename associated with the snippet."),
  tags: stringList().describe("Tags for categorization."),
  namespace: namespace().describe("Namespace to store in. Defaults to default."),
})

export const storeDecisionSchema = z.object({
  decision: z.string().min(1).describe("The decision that was made."),
  reasoning: z.string().optional().describe("Reasoning behind the decision."),
  alternatives: stringList().describe("Alternatives that were considered."),
  tags: stringList().describe("Tags for categorization."),
  caused_by_id: z.string().optional().describe("ID of the record that caused this decision."),
  namespace: namespace().describe("Namespace to store in. Defaults to default."),
})

export const searchSchema = z.object({
  query: z.string().optional().describe("Text substring to match."),
  level: level().describe("Filter by level: working, decisions, domain, identity."),
  tags: stringList().describe("Filter by tags. A matching record may contain any requested tag."),
  limit: limit().describe("Maximum records returned. Defaults to 20."),
  content_type: z.string().optional().describe("Filter by content type."),
  source_type: z.string().optional().describe("Filter by source type."),
  namespace: namespace().describe("Namespace to search in. Defaults to default."),
  semantic_type: z.string().optional().describe("Filter by semantic type."),
})

export const emptySchema = z.object({})

export const crossNamespaceDigestSchema = z.object({
  namespaces: stringList().describe("Optional subset of namespaces to include. Omit for all namespaces."),
  top_concepts_limit: limit().describe("Maximum concepts returned per namespace. Clamped by core."),
  min_record_count: limit().describe("Minimum record count required for a namespace to appear."),
  pairwise_similarity_threshold: z.number().min(0).max(1).optional().describe("Minimum pairwise similarity for pair entries."),
  include_dimensions: stringList().describe("Dimensions to include: concepts, tags, structural, causal, belief_states, corrections."),
  compact_summary: z.boolean().optional().describe("Omit bulky detail lists while keeping summaries and scores."),
})

export const explainRecordSchema = z.object({
  record_id: z.string().min(1).describe("Record ID to explain."),
})

export const explainRecallSchema = z.object({
  query: z.string().min(1).describe("Natural-language query to explain."),
  top_k: limit().describe("Maximum number of results to explain."),
  min_strength: z.number().min(0).max(1).optional().describe("Minimum record strength required for inclusion."),
  expand_connections: z.boolean().optional().describe("Whether graph/context expansion is enabled."),
  namespace: namespace().describe("Namespace to search in. Defaults to default."),
})

export const correctionLogSchema = z.object({
  target_kind: z.string().optional().describe("Optional target kind filter: belief, causal_pattern, policy_hint, or record."),
  target_id: z.string().optional().describe("Optional target ID filter; only applied together with target_kind."),
  limit: limit().describe("Maximum entries returned, newest first."),
})

export const correctionReviewQueueSchema = z.object({
  limit: limit().describe("Maximum review candidates returned, ordered by priority."),
})

export const contradictionReviewQueueSchema = z.object({
  namespace: namespace().describe("Optional namespace filter."),
  limit: limit().describe("Maximum review candidates returned, ordered by priority."),
})

export const suggestedCorrectionsSchema = z.object({
  limit: limit().describe("Maximum suggested corrections returned, ordered by priority."),
})

export const namespaceGovernanceSchema = z.object({
  namespaces: stringList().describe("Optional subset of namespaces to include. Omit for all namespaces."),
})

export const policyLifecycleSchema = z.object({
  namespace: namespace().describe("Optional namespace filter for list-style policy tools."),
  limit: limit().describe("Maximum number of returned items."),
  action_limit: limit().describe("Maximum action summary rows."),
  domain_limit: limit().describe("Maximum domain summary rows."),
})

export const beliefInstabilitySchema = z.object({
  min_volatility: z.number().min(0).max(1).optional().describe("Minimum volatility threshold for high-volatility beliefs."),
  max_stability: z.number().min(0).optional().describe("Maximum stability threshold for low-stability beliefs."),
  limit: limit().describe("Maximum number of returned items."),
})

export const memoryHealthSchema = z.object({
  limit: limit().describe("Maximum top issues returned."),
})

export const TOOL_NAMES = [
  "recall",
  "recall_structured",
  "store",
  "store_code",
  "store_decision",
  "search",
  "insights",
  "maintain",
  "cross_namespace_digest",
  "explain_record",
  "explain_recall",
  "explainability_bundle",
  "correction_log",
  "correction_review_queue",
  "contradiction_review_queue",
  "suggested_corrections",
  "namespace_governance_status",
  "policy_lifecycle",
  "belief_instability",
  "memory_health",
  "consolidate",
] as const

export type ToolName = (typeof TOOL_NAMES)[number]
