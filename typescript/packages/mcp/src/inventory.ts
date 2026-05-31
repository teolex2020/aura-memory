import { z } from "zod"

const stringList = () => z.array(z.string()).optional()
const namespace = () => z.string().optional()
const limit = () => z.number().int().positive().optional()
const level = () => z.enum(["working", "decisions", "domain", "identity"]).optional()

export type ToolImplementationStatus = "implemented" | "unsupported"

export type ToolInventoryEntry = {
  readonly name: string
  readonly status: ToolImplementationStatus
  readonly rustReference: string
  readonly responseMedia: "text" | "text-json"
  readonly coreSurface: string
}

export const TOOL_INVENTORY = [
  { name: "recall", status: "implemented", rustReference: "AuraMcpServer::recall (mcp.rs)", responseMedia: "text", coreSurface: "Aura.recall" },
  { name: "recall_structured", status: "implemented", rustReference: "AuraMcpServer::recall_structured (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.recall_structured" },
  { name: "store", status: "implemented", rustReference: "AuraMcpServer::store (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.store" },
  { name: "store_code", status: "implemented", rustReference: "AuraMcpServer::store_code (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.store_code" },
  { name: "store_decision", status: "implemented", rustReference: "AuraMcpServer::store_decision (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.store_decision" },
  { name: "search", status: "implemented", rustReference: "AuraMcpServer::search (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.search" },
  { name: "insights", status: "implemented", rustReference: "AuraMcpServer::insights (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.insights" },
  { name: "maintain", status: "implemented", rustReference: "TS-only Phase 7 MCP tool", responseMedia: "text-json", coreSurface: "Aura.maintain" },
  { name: "cross_namespace_digest", status: "implemented", rustReference: "AuraMcpServer::cross_namespace_digest (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.cross_namespace_digest_with_options" },
  { name: "explain_record", status: "implemented", rustReference: "AuraMcpServer::explain_record (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.explain_record" },
  { name: "explain_recall", status: "implemented", rustReference: "AuraMcpServer::explain_recall (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.explain_recall" },
  { name: "explainability_bundle", status: "implemented", rustReference: "AuraMcpServer::explainability_bundle (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.explainability_bundle" },
  { name: "correction_log", status: "implemented", rustReference: "AuraMcpServer::correction_log (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.get_correction_log" },
  { name: "correction_review_queue", status: "implemented", rustReference: "AuraMcpServer::correction_review_queue (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.correction_review_queue" },
  { name: "contradiction_review_queue", status: "implemented", rustReference: "AuraMcpServer::contradiction_review_queue (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.contradiction_review_queue" },
  { name: "suggested_corrections", status: "implemented", rustReference: "AuraMcpServer::suggested_corrections (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.suggested_corrections" },
  { name: "namespace_governance_status", status: "implemented", rustReference: "AuraMcpServer::namespace_governance_status (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.namespace_governance_status" },
  { name: "policy_lifecycle", status: "implemented", rustReference: "AuraMcpServer::policy_lifecycle (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.policy_lifecycle_report" },
  { name: "belief_instability", status: "implemented", rustReference: "AuraMcpServer::belief_instability (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.belief_instability_report" },
  { name: "memory_health", status: "implemented", rustReference: "AuraMcpServer::memory_health (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.memory_health" },
  { name: "consolidate", status: "unsupported", rustReference: "AuraMcpServer::consolidate (mcp.rs)", responseMedia: "text-json", coreSurface: "Aura.consolidate" },
] as const satisfies ReadonlyArray<ToolInventoryEntry>

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
  tags: stringList().describe("Filter by tags. A matching record must contain all requested tags."),
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

export type ToolName = (typeof TOOL_INVENTORY)[number]["name"]

export const TOOL_NAMES: ReadonlyArray<ToolName> = TOOL_INVENTORY.map((entry) => entry.name)
