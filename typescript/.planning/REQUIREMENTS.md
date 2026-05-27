# REQUIREMENTS.md

## REQ-001: TypeScript 1:1 Rewrite of Rust Core
TypeScript must implement all Rust core capabilities with byte-level disk format compatibility.

## REQ-002: effect-smol Layering
Core logic transparent to IO/cache/time/crypto; testable via dependency substitution.

## REQ-003: @aura/contract Package
Context Tags only; no implementations, no node:* imports.

## REQ-004: @aura/utils Package
Pure functions only; no IO, no Effect Context.

## REQ-005: @aura/platform-node Package
Bun/Node Live Layer implementations; only package with node:* imports.

## REQ-006: FileRead Service
readFile, exists, stat with Effect<...> return types.

## REQ-007: FileWrite Service
mkdirp, writeFile, appendFile, writeAt, fsync with Effect<...> return types.

## REQ-008: Crypto Service Contract
deriveKeyFromPassword, encryptData, decryptData, computeHmac.

## REQ-009: Recall Pipeline Alignment
SDR + NGram + Tags + optional Embedding; RRF fusion; graph/causal expansion; trust-aware scoring.

## REQ-010: Deterministic Tests
Fixed Clock, mock RecallView; Phase A (no disk), Phase B (fixtures), Phase C (verifier).

## REQ-011: Epistemic Layer Skeleton
Belief/Concept/Causal/Policy engines with effect-smol Context/Layer.

## REQ-012: Maintenance Pipeline End-to-End
Trace → Belief → Concept → Causal → Policy with bounded reranking and finalize.
