# CONCERNS.md — Risks, Technical Debt & Known Gaps

## High Priority — Rust Parity Gaps

### 1. NGramIndex: Simplified Trigram Jaccard (Not MinHash+LSH)
- **Location**: `packages/storage/src/RecallView.ts`
- **Current**: Trigram Jaccard similarity over record `content`
- **Rust**: MinHash + LSH (`src/ngram.rs`)
- **Impact**: Candidate sets, similarity distribution, and RRF fusion stability diverge from Rust
- **Marker**: `SIMPLE IMPLEMENTATION: port Rust NGramIndex (minhash/LSH)`
- **Action**: Implement MinHash+LSH with deterministic seed for parity testing

### 2. SDR Overlap Weighting Missing
- **Location**: `packages/recall/src/Signals.ts` (`collectSdr`)
- **Current**: Tanimoto only; inverted index overlap count not incorporated into scoring
- **Rust**: Overlap participates in candidate ranking
- **Impact**: Tie-breaking and candidate ordering may differ
- **Action**: Introduce overlap into weight/sort strategy

### 3. Bounded Rerank / Finalize Not Default
- **Location**: `packages/recall/src/Pipeline.ts`, `packages/core/src/Recall.ts`
- **Current**: Optional services — missing means skip
- **Rust**: `recall_core` always applies bounded reranking and finalize side effects
- **Impact**: TS output closer to `recall_raw` than `recall_core`
- **Action**: Provide default Live Layer or explicitly expose `recallRaw` vs `recallCore`

## Medium Priority — Data Model & Persistence

### 4. Record Schema Normalization Incomplete
- **Location**: `packages/storage/src/CognitiveRecord.ts`
- **Current**: Minimal field defaults (`content_type`, `metadata`, `connections`)
- **Rust**: Full default/validation logic for tags, namespace, source_type, strength
- **Impact**: Missing fields cause filtering/scoring divergence in recall
- **Action**: Complete Record schema validation and defaults

### 5. Graph/Causal Fields Not Written
- **Location**: Write path (not fully implemented)
- **Current**: `connections` and `caused_by_id` come from raw JSON if present
- **Rust**: `finalize`/`strengthen` persist these fields
- **Impact**: Graph/causal expansion weaker than Rust in long-running use
- **Action**: Implement write-side finalize/strengthen persistence

### 6. Write Path Coverage Thin
- **Current focus**: Read-first (recall pipeline)
- **Missing**: Full cognitive store write, belief/concept/causal store writes, atomic rename/fsync patterns in production use
- **Action**: Expand storage tests and implement atomic write helpers

## Low-Medium Priority — Observability & Performance

### 7. No Recall Cache
- **Rust**: `runtime.recall_cache` caches recall results
- **TS**: Not implemented
- **Impact**: Performance divergence; no functional impact yet

### 8. No Trace / Explainability Output
- **Rust**: `recall_with_trace` provides structured explanation
- **TS**: No trace sink
- **Impact**: Debugging recall behavior harder than in Rust
- **Action**: Define `RecallTraceSink` contract and optional implementation

### 9. NGramIndex Randomness
- **Mitigation**: Rust verifier uses `NGramIndex::with_seed(...)` for deterministic tests
- **Status**: Resolved for tests; main TS implementation still needs proper MinHash+LSH

## Infrastructure Concerns

### 10. No Linting / Formatting
- No ESLint, Prettier, Biome, or dprint configured
- Risk: style drift, missed bugs that static analysis could catch
- **Action**: Add Biome or dprint for fast, unified formatting and linting

### 11. Test Gaps in Maintenance Chain
- `causal`, `policy`, `epistemic-runtime` have zero tests
- `belief` only has engine tests; store untested
- Risk: regressions in epistemic maintenance pipeline

### 12. Platform-Node Untested
- `NodeFileRead`, `NodeFileWrite`, `NodeClock`, `NodeCrypto` have no unit tests
- Risk: IO behavior changes with Node/Bun versions
- Mitigation: thin wrappers, mostly delegating to stdlib

## Design Tensions

### Optional Services vs. Rust Default Behavior
- TS design allows graceful degradation (missing embedding/rerank/finalize)
- Rust assumes these are always present in `recall_core`
- **Resolution needed**: Either provide default implementations in core, or clearly document TS as `recallRaw` equivalent

### Effect-TS Beta Dependency
- `effect@4.0.0-beta.68` — beta version may have API changes before stable
- Risk: migration work when 4.0 stable releases
- Mitigation: limited API surface used (Context, Layer, Effect.gen, Option, Data.TaggedError)
