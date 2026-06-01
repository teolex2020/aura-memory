# BACKLOG.md

Last updated: 2026-06-01

## Usage Notes

- `STATE.md` and `ROADMAP.md` define coarse planning boundaries, but may lag behind active implementation.
- `IMPLEMENTATION-LOG.md` is the immediate progress ledger for completed alignment work.
- This backlog tracks remaining Rust semantic parity work and marks completed items once implementation plus verification are recorded.

## Active Objective

与 Rust 版本的核心功能彻底对齐：写入、召回、自动维护、可解释性为主，Python 导出 API 等次要 surface 随后补齐。在遵守包边界的前提下尽量保留 Rust 模块结构，并保留 Rust 原始代码位置引用与函数/方法/类/逻辑块注释。

## Completed Alignment Work

- [x] NGramIndex SynonymRing expansion parity — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Core/RRF signature JSDoc comment cleanup — recorded in `IMPLEMENTATION-LOG.md`.
- [x] RRF filter helper internalized into `RRF.ts` and Rust-shaped `rrfFuse` signature confirmed — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Aura `decay` / `reflect` maintenance facade parity — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Aura `end_session` / instance-level session tracker parity — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Recall namespace filter Rust semantics — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Core recall/session/finalizer JSDoc cleanup — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Embedding signal RRF filtering position parity — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Legacy `packages/recall` RecallFinalizer implementation and tests removed after migration to `@aura/core` — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Maintenance BackgroundBrain cross-connection and scheduled task semantics aligned — recorded in `IMPLEMENTATION-LOG.md`.
- [x] NGramIndex random coefficient distribution aligned to Rust `gen_range` semantics — recorded in `IMPLEMENTATION-LOG.md`.
- [x] ConceptEngine and NGramIndex now share Rust-compatible `xxh3_64` from `@aura/utils` — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Maintenance engine stable IDs and causal fingerprints now use Rust-compatible `xxh3_64` — recorded in `IMPLEMENTATION-LOG.md`.
- [x] SDRInterpreter seed hashing now reuses Rust-compatible `@aura/utils` `xxh3_64`; `xxhash-wasm` dependency removed — recorded in `IMPLEMENTATION-LOG.md`.
- [x] Core `Graph.ts` skeleton extracted for Rust `graph.rs` parity and reused by `Aura.delete` graph cleanup — recorded in `IMPLEMENTATION-LOG.md`.

## Open Parity Backlog

- [ ] Core facade store/update/connect and remaining delete storage/index/cache semantics: close remaining `SIMPLE IMPLEMENTATION:` markers in `packages/core/src/Aura.ts`.
- [ ] Core recall output shape: replace simplified `recall_structured` / `recall_full` surfaces with Rust-rich recall item semantics.
- [ ] Recall cache invalidation: implement Rust `runtime.clear_recall_caches()` behavior after write-affecting operations.
- [ ] Encryption/password wiring: close `Aura.open_with_password` password/encryption NON-PARITY gap.
- [ ] Consolidation: replace typed unsupported `consolidate` surface with a real Rust-parity merge algorithm and coherent index mutation path.
- [ ] Relation/entity/project/family graph APIs: implement currently typed unsupported Python/API surfaces.
- [ ] Maintenance history/reflection persistence decision: either match Rust in-memory behavior exactly or keep documented TS persistence as explicit parity exception.
- [ ] RecallView startup/load gap: audit `SIMPLE IMPLEMENTATION:` in `packages/storage/src/RecallView.ts` against Rust read model construction.
- [ ] MCP parity exact scores: close the remaining test-level NON-PARITY note in `packages/mcp/src/Parity.test.ts`.
- [ ] Python exported API parity: continue regex/surface audit for remaining PyO3-exported Rust APIs and add TS facades where in scope.

## Current Marker Snapshot

- `rg "NON-PARITY IMPLEMENTATION|SIMPLE IMPLEMENTATION|UNIMPLEMENTED|TODO:" packages -n` still reports open markers in `packages/core`, `packages/recall`, `packages/storage`, and MCP parity tests.
- `packages/code-extraction` TODO markers are currently out of the Aura Rust-core parity path unless later brought into scope.
