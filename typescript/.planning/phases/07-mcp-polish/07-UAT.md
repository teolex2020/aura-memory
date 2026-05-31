---
status: testing
phase: 07-mcp-polish
source:
  - 07-06-SUMMARY.md
  - 07-07-SUMMARY.md
  - 07-08-SUMMARY.md
started: 2026-05-31T17:11:15.7323893+08:00
updated: 2026-05-31T17:11:15.7323893+08:00
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: MCP Stdio Startup And Tool Inventory
expected: |
  Starting the Phase 7 MCP stdio entrypoint succeeds against a fresh Aura brain, and MCP tool discovery shows the complete advertised Phase 7 tool inventory, including recall, store, search, maintain, governance, explainability, correction, memory_health, and consolidate.
awaiting: user response

## Tests

### 1. MCP Stdio Startup And Tool Inventory
expected: Starting the Phase 7 MCP stdio entrypoint succeeds against a fresh Aura brain, and MCP tool discovery shows the complete advertised Phase 7 tool inventory, including recall, store, search, maintain, governance, explainability, correction, memory_health, and consolidate.
result: [pending]

### 2. Memory Write And Retrieval Flow
expected: Through the MCP tools, storing a memory or decision returns a record id and level, search can find the stored record by query/tags/namespace, recall returns bounded text context, and recall_structured returns JSON text with scored records.
result: [pending]

### 3. Maintenance And Governance Surfaces
expected: The maintain tool runs against the bound brain and returns a maintenance report, while memory_health, namespace_governance_status, policy_lifecycle, belief_instability, and cross_namespace_digest return JSON text payloads rather than empty transport errors.
result: [pending]

### 4. Explainability And Correction Surfaces
expected: explain_record, explain_recall, explainability_bundle, correction_log, correction_review_queue, contradiction_review_queue, and suggested_corrections all return deterministic JSON text payloads through MCP without requiring business logic in the transport layer.
result: [pending]

### 5. Unsupported Consolidate Is Explicit
expected: Calling consolidate over MCP returns a standardized JSON text error with code unsupported_surface, surface Aura.consolidate, Rust reference information, and missing prerequisites; it must not return dummy success.
result: [pending]

### 6. MCP Parity Artifact Is Honest
expected: The Phase 7 parity artifact records TS MCP family payloads and inventory coverage. If no Rust MCP binary or golden payload is available, it reports skipped_no_rust_or_golden explicitly instead of claiming parity passed.
result: [pending]

### 7. Passworded MCP Startup Fails Fast
expected: If AURA_PASSWORD is set before encrypted storage parity exists, the TypeScript runtime fails explicitly with UnsupportedSurfaceError instead of silently opening the brain without password protection.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps

[]
