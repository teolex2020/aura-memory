# Phase 07-08 MCP Parity Verification

- Status: skipped_no_rust_or_golden
- Rust preflight: unavailable (insufficient free disk for safe cargo build preflight (2596929536 bytes available))
- Golden payload: not available
- Families: write, retrieval, governance
- Implemented tools: recall, recall_structured, store, store_code, store_decision, search, insights, maintain, cross_namespace_digest, explain_record, explain_recall, explainability_bundle, correction_log, correction_review_queue, contradiction_review_queue, suggested_corrections, namespace_governance_status, policy_lifecycle, belief_instability, memory_health
- Unsupported tools: consolidate
- TS-only note: maintain is validated locally and excluded from Rust comparison because it is not in Rust MCP inventory.
- Unsupported note: consolidate is validated locally as an explicit unsupported TS surface and excluded from Rust comparison.
- Fixture strategy: this harness uses fresh MCP-focused temp brain directories initialized with brain.aura, then runs identical family call sequences over TS and Rust. recall_parity assets are not required for this MCP-level fixture.
- Normalization: recursive JSON key sorting, safe float rounding to 6 decimals, CRLF/trailing-whitespace normalization for non-JSON text only. Media type changes and missing/extra fields are not ignored.
