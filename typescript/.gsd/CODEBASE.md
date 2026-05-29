# Codebase Map

Generated: 2026-05-28T16:53:02Z | Files: 256 | Described: 0/256
<!-- gsd:codebase-meta {"generatedAt":"2026-05-28T16:53:02Z","fingerprint":"7f3c6cfad269dc6cb09971799b68b554dff7b272","fileCount":256,"truncated":false} -->

### (root)/
- `Agents.md`
- `package.json`
- `README.md`
- `README.zh.md`
- `REPORT.md`
- `tsconfig.json`
- `vitest.config.ts`

### docs/
- `docs/ARCHITECTURE.md`
- `docs/CONFIGURATION.md`
- `docs/DEVELOPMENT.md`
- `docs/GETTING-STARTED.md`
- `docs/TESTING.md`

### docs/zh/
- `docs/zh/ARCHITECTURE.zh.md`
- `docs/zh/CONFIGURATION.zh.md`
- `docs/zh/DEVELOPMENT.zh.md`
- `docs/zh/GETTING-STARTED.zh.md`
- `docs/zh/TESTING.zh.md`

### packages/belief/
- `packages/belief/package.json`

### packages/belief/src/
- `packages/belief/src/BeliefEngine.test.ts`
- `packages/belief/src/BeliefEngine.ts`
- `packages/belief/src/BeliefEngine.zh.test.ts`
- `packages/belief/src/BeliefStore.ts`
- `packages/belief/src/index.ts`

### packages/causal/
- `packages/causal/package.json`

### packages/causal/src/
- `packages/causal/src/CausalEngine.test.ts`
- `packages/causal/src/CausalEngine.ts`
- `packages/causal/src/CausalStore.ts`
- `packages/causal/src/index.ts`

### packages/code-extraction/
- `packages/code-extraction/package.json`

### packages/code-extraction/.codegraph/
- `packages/code-extraction/.codegraph/.gitignore`

### packages/code-extraction/src/
- `packages/code-extraction/src/directory.ts`
- `packages/code-extraction/src/env.d.ts`
- `packages/code-extraction/src/errors.ts`
- `packages/code-extraction/src/index.ts`
- `packages/code-extraction/src/types.ts`
- `packages/code-extraction/src/utils.ts`
- `packages/code-extraction/src/web-tree-sitter.d.ts`

### packages/code-extraction/src/context/
- `packages/code-extraction/src/context/formatter.ts`
- `packages/code-extraction/src/context/index.ts`

### packages/code-extraction/src/db/
- `packages/code-extraction/src/db/index.ts`
- `packages/code-extraction/src/db/migrations.ts`
- `packages/code-extraction/src/db/queries.ts`
- `packages/code-extraction/src/db/schema.sql`
- `packages/code-extraction/src/db/sqlite-adapter.ts`

### packages/code-extraction/src/extraction/
- `packages/code-extraction/src/extraction/dfm-extractor.ts`
- `packages/code-extraction/src/extraction/grammars.ts`
- `packages/code-extraction/src/extraction/index.ts`
- `packages/code-extraction/src/extraction/liquid-extractor.ts`
- `packages/code-extraction/src/extraction/parse-worker.ts`
- `packages/code-extraction/src/extraction/svelte-extractor.ts`
- `packages/code-extraction/src/extraction/tree-sitter-helpers.ts`
- `packages/code-extraction/src/extraction/tree-sitter-types.ts`
- `packages/code-extraction/src/extraction/tree-sitter.ts`
- `packages/code-extraction/src/extraction/vue-extractor.ts`
- `packages/code-extraction/src/extraction/wasm-runtime-flags.ts`

### packages/code-extraction/src/extraction/languages/
- `packages/code-extraction/src/extraction/languages/c-cpp.ts`
- `packages/code-extraction/src/extraction/languages/csharp.ts`
- `packages/code-extraction/src/extraction/languages/dart.ts`
- `packages/code-extraction/src/extraction/languages/go.ts`
- `packages/code-extraction/src/extraction/languages/index.ts`
- `packages/code-extraction/src/extraction/languages/java.ts`
- `packages/code-extraction/src/extraction/languages/javascript.ts`
- `packages/code-extraction/src/extraction/languages/kotlin.ts`
- `packages/code-extraction/src/extraction/languages/lua.ts`
- `packages/code-extraction/src/extraction/languages/luau.ts`
- `packages/code-extraction/src/extraction/languages/objc.ts`
- `packages/code-extraction/src/extraction/languages/pascal.ts`
- `packages/code-extraction/src/extraction/languages/php.ts`
- `packages/code-extraction/src/extraction/languages/python.ts`
- `packages/code-extraction/src/extraction/languages/ruby.ts`
- `packages/code-extraction/src/extraction/languages/rust.ts`
- `packages/code-extraction/src/extraction/languages/scala.ts`
- `packages/code-extraction/src/extraction/languages/swift.ts`
- `packages/code-extraction/src/extraction/languages/typescript.ts`

### packages/code-extraction/src/extraction/wasm/
- `packages/code-extraction/src/extraction/wasm/tree-sitter-lua.wasm`
- `packages/code-extraction/src/extraction/wasm/tree-sitter-luau.wasm`
- `packages/code-extraction/src/extraction/wasm/tree-sitter-pascal.wasm`
- `packages/code-extraction/src/extraction/wasm/tree-sitter-scala.wasm`

### packages/code-extraction/src/graph/
- `packages/code-extraction/src/graph/index.ts`
- `packages/code-extraction/src/graph/queries.ts`
- `packages/code-extraction/src/graph/traversal.ts`

### packages/code-extraction/src/resolution/
- `packages/code-extraction/src/resolution/callback-synthesizer.ts`
- `packages/code-extraction/src/resolution/import-resolver.ts`
- `packages/code-extraction/src/resolution/index.ts`
- `packages/code-extraction/src/resolution/lru-cache.ts`
- `packages/code-extraction/src/resolution/name-matcher.ts`
- `packages/code-extraction/src/resolution/path-aliases.ts`
- `packages/code-extraction/src/resolution/strip-comments.ts`
- `packages/code-extraction/src/resolution/swift-objc-bridge.ts`
- `packages/code-extraction/src/resolution/types.ts`

### packages/code-extraction/src/resolution/frameworks/
- *(21 files: 21 .ts)*

### packages/code-extraction/src/search/
- `packages/code-extraction/src/search/query-parser.ts`
- `packages/code-extraction/src/search/query-utils.ts`

### packages/codec/
- `packages/codec/package.json`

### packages/codec/src/
- `packages/codec/src/Binary.test.ts`
- `packages/codec/src/Binary.ts`
- `packages/codec/src/Bincode.test.ts`
- `packages/codec/src/Bincode.ts`
- `packages/codec/src/Crypto.test.ts`
- `packages/codec/src/Crypto.ts`
- `packages/codec/src/index.ts`

### packages/concept/
- `packages/concept/package.json`

### packages/concept/src/
- `packages/concept/src/ConceptEngine.test.ts`
- `packages/concept/src/ConceptEngine.ts`
- `packages/concept/src/ConceptStore.ts`
- `packages/concept/src/index.ts`
- `packages/concept/src/Surface.test.ts`
- `packages/concept/src/Surface.ts`

### packages/contract/
- `packages/contract/package.json`

### packages/contract/src/
- `packages/contract/src/Belief.ts`
- `packages/contract/src/Causal.ts`
- `packages/contract/src/Clock.ts`
- `packages/contract/src/Concept.ts`
- `packages/contract/src/Context.ts`
- `packages/contract/src/Crypto.ts`
- `packages/contract/src/Enums.test.ts`
- `packages/contract/src/EpistemicInspection.ts`
- `packages/contract/src/EpistemicRuntime.ts`
- `packages/contract/src/EpistemicTrace.ts`
- `packages/contract/src/Errors.ts`
- `packages/contract/src/FileRead.ts`
- `packages/contract/src/FileWrite.ts`
- `packages/contract/src/index.ts`
- `packages/contract/src/Maintenance.ts`
- `packages/contract/src/Optional.test.ts`
- `packages/contract/src/Optional.ts`
- `packages/contract/src/Policy.ts`
- `packages/contract/src/Recall.test.ts`
- `packages/contract/src/Recall.ts`

### packages/contract/src/belief/
- `packages/contract/src/belief/BeliefTypes.ts`

### packages/contract/src/causal/
- `packages/contract/src/causal/CausalTypes.ts`

### packages/contract/src/concept/
- `packages/contract/src/concept/ConceptTypes.ts`

### packages/contract/src/levels/
- `packages/contract/src/levels/Level.ts`

### packages/contract/src/policy/
- `packages/contract/src/policy/PolicyTypes.ts`

### packages/contract/src/record/
- `packages/contract/src/record/Record.ts`

### packages/contract/src/relation/
- `packages/contract/src/relation/Relation.ts`

### packages/contract/src/sdr/
- `packages/contract/src/sdr/Sdr.ts`

### packages/core/
- `packages/core/package.json`

### packages/core/src/
- `packages/core/src/Aura.test.ts`
- `packages/core/src/Aura.ts`
- `packages/core/src/DefaultLayer.test.ts`
- `packages/core/src/DefaultLayer.ts`
- `packages/core/src/index.ts`
- `packages/core/src/MaintenanceService.test.ts`
- `packages/core/src/MaintenanceService.ts`
- `packages/core/src/Recall.parity.test.ts`
- `packages/core/src/Recall.test.ts`
- `packages/core/src/Recall.ts`

### packages/epistemic-runtime/
- `packages/epistemic-runtime/package.json`

### packages/epistemic-runtime/src/
- `packages/epistemic-runtime/src/EpistemicRuntime.test.ts`
- `packages/epistemic-runtime/src/EpistemicRuntime.ts`
- `packages/epistemic-runtime/src/EpistemicTrace.ts`
- `packages/epistemic-runtime/src/index.ts`

### packages/indexing/
- `packages/indexing/package.json`

### packages/indexing/src/
- `packages/indexing/src/index.ts`
- `packages/indexing/src/InvertedIndex.fixture.test.ts`
- `packages/indexing/src/InvertedIndex.roundtrip.test.ts`
- `packages/indexing/src/InvertedIndex.searchScored.test.ts`
- `packages/indexing/src/InvertedIndex.ts`
- `packages/indexing/src/Roaring.test.ts`
- `packages/indexing/src/Roaring.ts`

### packages/platform-node/
- `packages/platform-node/package.json`

### packages/platform-node/src/
- `packages/platform-node/src/index.ts`
- `packages/platform-node/src/NodeClock.ts`
- `packages/platform-node/src/NodeCrypto.ts`
- `packages/platform-node/src/NodeFileRead.ts`
- `packages/platform-node/src/NodeFileWrite.ts`

### packages/policy/
- `packages/policy/package.json`

### packages/policy/src/
- `packages/policy/src/index.ts`
- `packages/policy/src/PolicyEngine.test.ts`
- `packages/policy/src/PolicyEngine.ts`
- `packages/policy/src/PolicyStore.ts`
- `packages/policy/src/Surface.test.ts`
- `packages/policy/src/Surface.ts`

### packages/recall/
- `packages/recall/package.json`

### packages/recall/src/
- `packages/recall/src/BoundedReranker.test.ts`
- `packages/recall/src/BoundedReranker.ts`
- `packages/recall/src/CausalWalk.ts`
- `packages/recall/src/Errors.ts`
- `packages/recall/src/GraphWalk.ts`
- `packages/recall/src/index.ts`
- `packages/recall/src/Pipeline.test.ts`
- `packages/recall/src/Pipeline.ts`
- `packages/recall/src/RecallFinalizer.test.ts`
- `packages/recall/src/RecallFinalizer.ts`
- `packages/recall/src/RRF.ts`
- `packages/recall/src/SDRInterpreter.test.ts`
- `packages/recall/src/SDRInterpreter.ts`
- `packages/recall/src/Signals.ts`
- `packages/recall/src/Trust.test.ts`
- `packages/recall/src/Trust.ts`
- `packages/recall/src/Types.ts`

### packages/storage/
- `packages/storage/package.json`

### packages/storage/src/
- *(29 files: 29 .ts)*

### packages/utils/
- `packages/utils/package.json`

### packages/utils/src/
- `packages/utils/src/Bytes.ts`
- `packages/utils/src/Crc32.ts`
- `packages/utils/src/Hex.ts`
- `packages/utils/src/Id12.ts`
- `packages/utils/src/index.ts`
- `packages/utils/src/path.ts`
- `packages/utils/src/Time.ts`

### test/fixtures/
- `test/fixtures/.gitkeep`

### test/fixtures/epistemic_belief_v1/
- `test/fixtures/epistemic_belief_v1/expected.json`
- `test/fixtures/epistemic_belief_v1/records.json`

### test/fixtures/minimal_brain/
- `test/fixtures/minimal_brain/temporal.bin`

### test/fixtures/minimal_index/
- `test/fixtures/minimal_index/index_manifest.json`
- `test/fixtures/minimal_index/sdr.idx`
